import { formatUnits, parseUnits, type Address } from "viem";
import {
  checkAllowance,
  simulateSwapOutput,
  buildExactInputSingleTransaction,
  readPoolPrice,
  getErc20Decimals,
  getErc20Balance,
  getPublicClient,
  PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
  type AllowanceCheckResult,
  type PoolPriceResult,
} from "../data/pancakeswap-v3";
import { getPoolsForTicker } from "../data/pool-addresses";
import { BSC_USDT_ADDRESS } from "../data/quotes";
import { defaultBinanceCallLog, type BinanceCallRecord } from "../data/binance-client";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import { isPublicReadOnly } from "../config/deployment";
import { send, getTradingWalletAddress, SentButUnconfirmedError, type SendResult, type UnsignedTransaction } from "./agentic-wallet";
import { applySlippageTolerance } from "./pipeline";
import {
  defaultLedger,
  type AuditLedger,
  type ExecutionTestLedgerEntry,
  type ExecutionTestLeg,
  type PipelineMode,
} from "./audit-ledger";
import type { TxSimulation } from "../data/binance-transaction";

// A MANUAL execution test, not arbitrage. Two actions, one route:
//   "round_trip" — buy up to $5 of MSFTB on the 0.25% pool, then sell what
//                  was received back into the same pool;
//   "sell_only"  — recovery: sell the MSFTB the wallet holds (up to $5
//                  worth) back into the same pool, e.g. after a round trip
//                  whose sell leg failed.
// It exists to prove the real send path end to end (allowance/approval,
// Binance simulate, MEV-protected Binance broadcast, receipt) with an
// amount small enough to lose. Reachable only from POST
// /api/execution-test — test/architecture.test.ts fails if the scheduler,
// the agent loop, or the instruction handler reference it.

// Hard cap, in code, on each leg's value. Not configurable at runtime.
export const EXECUTION_TEST_HARD_CAP_USD_PER_LEG = 5;

// Refuse to start without this much BNB for gas. Binance's simulate does
// not check the gas balance (docs/devex-log.md, 2026-09-25), so without
// this check an empty wallet would pass simulation and fail at broadcast.
export const EXECUTION_TEST_MIN_BNB_WEI = parseUnits("0.0005", 18);

// Health gate: the last N Binance calls the app made (scheduler quotes
// and market-status reads) must all have succeeded, each within the
// latency limit. Binance was intermittently unreachable from this
// machine on 2026-09-25; starting a test into that is how a buy completes
// and its sell can't be sent.
export const EXECUTION_TEST_HEALTH_CALLS = 3;
export const EXECUTION_TEST_HEALTH_MAX_LATENCY_MS = 5_000;

const POOL_FEE_UNITS = 2500; // the 0.25% MSFTB/USDT pool

function testPool(): { address: Address; feeUnits: number } {
  const pool = getPoolsForTicker("MSFT").find((p) => p.feeUnits === POOL_FEE_UNITS);
  if (!pool) throw new Error("the 0.25% MSFTB pool is not registered in lib/data/pool-addresses.ts");
  return { address: pool.address as Address, feeUnits: pool.feeUnits };
}

export type ExecutionTestAction = "round_trip" | "sell_only";

export interface ExecutionTestRequest {
  // Defaults to "round_trip".
  action?: ExecutionTestAction;
  // Round trip only: USDT to spend on the buy leg (at most the cap).
  // Ignored by sell_only, which sells what the wallet holds.
  sizeUsd?: number;
  // Must be literally true. Nothing defaults it.
  confirm: boolean;
}

export const SELL_ONLY_REQUEST = '{"action":"sell_only","confirm":true}';

export interface ExecutionTestDeps {
  // Required, with no default: the caller must read the killswitch.
  getKillswitchMode: () => PipelineMode;
  // Required, with no default: the caller passes the same daily spend
  // tracker the scheduler and manual instructions use, so the execution
  // test counts toward the one daily cap. (Structural type: the tracker
  // lives in orchestration/, which execution/ doesn't import.)
  spendTracker: { recordSpend(amountUsd: number): void; getSpentToday(): number };
  perDayCapUsd?: number;
  ledger?: AuditLedger;
  // The most recent Binance calls, oldest first. Defaults to the app's
  // own call log (the same one /api/status shows).
  recentBinanceCalls?: (count: number) => BinanceCallRecord[];
  getWalletAddress?: () => Address;
  readPool?: (pool: { address: Address; feeUnits: number }) => Promise<PoolPriceResult>;
  getDecimals?: (token: Address) => Promise<number>;
  getBalance?: (token: Address, owner: Address) => Promise<bigint>;
  getNativeBalance?: (owner: Address) => Promise<bigint>;
  checkAllowance?: (params: {
    tokenAddress: Address;
    ownerAddress: Address;
    spenderAddress: Address;
    amountRequired: bigint;
  }) => Promise<AllowanceCheckResult>;
  quote?: (params: { tokenIn: Address; tokenOut: Address; amountIn: bigint; feeUnits: number }) => Promise<{ amountOut: bigint; gasEstimate: bigint }>;
  send?: (tx: UnsignedTransaction) => Promise<SendResult>;
  slippageTolerance?: number;
}

// Pure: why the Binance connection isn't healthy enough to start, or null.
export function binanceHealthProblem(calls: readonly BinanceCallRecord[]): string | null {
  const need = EXECUTION_TEST_HEALTH_CALLS;
  const limit = EXECUTION_TEST_HEALTH_MAX_LATENCY_MS;
  if (calls.length < need) return `Binance health gate: only ${calls.length} Binance call(s) recorded; need the last ${need} to have succeeded`;
  const bad = calls
    .slice(-need)
    .filter((c) => !c.ok || c.latencyMs > limit)
    .map((c) => `${c.at} ${c.path} ${c.ok ? `ok but ${c.latencyMs} ms` : `failed (${c.httpStatus === null ? "no response" : `HTTP ${c.httpStatus}`}${c.apiCode !== null ? ` code ${c.apiCode}` : ""}, ${c.latencyMs} ms)`}`);
  if (bad.length === 0) return null;
  return `Binance health gate: the last ${need} Binance calls must all succeed within ${limit} ms; not met: ${bad.join("; ")}`;
}

// One run at a time per process. On globalThis like the other shared
// state, so a second bundle can't start a concurrent run.
const IN_FLIGHT_KEY = Symbol.for("basis.executionTest.inFlight");
const inFlight = globalThis as unknown as Record<symbol, boolean | undefined>;

type Base = Pick<ExecutionTestLedgerEntry, "action" | "mode" | "sizeUsd" | "pool">;

export async function runExecutionTest(request: ExecutionTestRequest, deps: ExecutionTestDeps): Promise<ExecutionTestLedgerEntry> {
  const ledger = deps.ledger ?? defaultLedger;
  const mode = deps.getKillswitchMode();
  const pool = testPool();
  const action = request.action ?? "round_trip";
  const sizeUsd = action === "round_trip" ? Number(request.sizeUsd) : 0;
  const base: Base = { action, mode, sizeUsd, pool };
  const refuse = (reason: string) => ledger.appendExecutionTest({ ...base, outcome: "refused", reason, legs: [], spendRecordedUsd: 0 });
  const perDayCapUsd = deps.perDayCapUsd ?? DEFAULT_GUARDRAIL_CONFIG.perDayCapUsd;

  if (isPublicReadOnly()) return refuse("PUBLIC_READ_ONLY: the execution test runs locally only, never on a public deployment");
  if (action !== "round_trip" && action !== "sell_only") return refuse(`unknown action "${String(action)}"`);
  if (action === "round_trip") {
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) return refuse(`sizeUsd must be a positive number (got ${request.sizeUsd})`);
    if (sizeUsd > EXECUTION_TEST_HARD_CAP_USD_PER_LEG) {
      return refuse(`sizeUsd $${sizeUsd} exceeds the hard cap of $${EXECUTION_TEST_HARD_CAP_USD_PER_LEG} per leg`);
    }
  }
  if (request.confirm !== true) return refuse("explicit confirmation missing: the request must include confirm: true");
  if (mode !== "live") return refuse(`the killswitch is "${mode}"; the execution test sends real transactions and runs only in "live"`);

  const health = binanceHealthProblem((deps.recentBinanceCalls ?? ((n) => defaultBinanceCallLog.recent(n)))(EXECUTION_TEST_HEALTH_CALLS));
  if (health) return refuse(health);

  if (action === "round_trip") {
    // Both legs count toward the daily cap, so both must fit before the
    // first one is sent. Same comparison as the guardrail's dailyCapCheck.
    const spentToday = deps.spendTracker.getSpentToday();
    const projected = spentToday + 2 * sizeUsd;
    if (projected > perDayCapUsd) {
      return refuse(`projected daily spend $${projected} (already spent $${spentToday} + two legs of $${sizeUsd}) exceeds daily cap $${perDayCapUsd}`);
    }
  }
  if (inFlight[IN_FLIGHT_KEY]) return refuse("another execution test is already running");

  inFlight[IN_FLIGHT_KEY] = true;
  try {
    return await run(action, sizeUsd, pool, deps, ledger, base, perDayCapUsd);
  } finally {
    inFlight[IN_FLIGHT_KEY] = false;
  }
}

async function run(
  action: ExecutionTestAction,
  sizeUsd: number,
  pool: { address: Address; feeUnits: number },
  deps: ExecutionTestDeps,
  ledger: AuditLedger,
  base: Base,
  perDayCapUsd: number
): Promise<ExecutionTestLedgerEntry> {
  const readPool = deps.readPool ?? ((p) => readPoolPrice(p.address, BSC_USDT_ADDRESS, p.feeUnits));
  const getDecimals = deps.getDecimals ?? getErc20Decimals;
  const getBalance = deps.getBalance ?? getErc20Balance;
  const getNativeBalance = deps.getNativeBalance ?? ((owner) => getPublicClient().getBalance({ address: owner }));

  // A leg's notional counts once its swap is sent — mined, or broadcast
  // with its receipt unconfirmed (counted conservatively). The pipeline
  // records spend only for an "executed" order.
  let spendRecordedUsd = 0;
  const recordSpend = (usd: number) => {
    deps.spendTracker.recordSpend(usd);
    spendRecordedUsd += usd;
  };
  const refused = (reason: string) => ledger.appendExecutionTest({ ...base, outcome: "refused", reason, legs: [], spendRecordedUsd });

  let wallet: Address;
  let target: Address;
  let targetDecimals: number;
  try {
    wallet = (deps.getWalletAddress ?? (() => getTradingWalletAddress() as Address))();
    const reading = await readPool(pool);
    target = reading.token0.toLowerCase() === BSC_USDT_ADDRESS.toLowerCase() ? reading.token1 : reading.token0;
    targetDecimals = await getDecimals(target);
    const bnb = await getNativeBalance(wallet);
    if (bnb < EXECUTION_TEST_MIN_BNB_WEI) {
      return refused(`trading wallet holds ${formatUnits(bnb, 18)} BNB; at least ${formatUnits(EXECUTION_TEST_MIN_BNB_WEI, 18)} BNB is required for gas`);
    }
  } catch (err) {
    return refused(message(err));
  }

  // What the wallet holds of the target token after a leg, for the ledger.
  const heldAfter = async (): Promise<string | undefined> => {
    try {
      return (await getBalance(target, wallet)).toString();
    } catch {
      return undefined;
    }
  };

  // The largest amount of the target worth at most the cap at `priceUsd`.
  const capUnitsAt = (priceUsd: number) =>
    parseUnits((Math.floor((EXECUTION_TEST_HARD_CAP_USD_PER_LEG / priceUsd) * 1e12) / 1e12).toFixed(12), targetDecimals);

  if (action === "sell_only") {
    let amount: bigint;
    let priceUsd: number;
    let held: bigint;
    try {
      held = await getBalance(target, wallet);
      if (held === 0n) return refused("sell_only: the wallet holds no MSFTB — nothing to sell");
      priceUsd = (await readPool(pool)).priceUsd;
      const cap = capUnitsAt(priceUsd);
      amount = held < cap ? held : cap;
    } catch (err) {
      return refused(message(err));
    }
    const valueUsd = Number(formatUnits(amount, targetDecimals)) * priceUsd;
    const spentToday = deps.spendTracker.getSpentToday();
    if (spentToday + valueUsd > perDayCapUsd) {
      return refused(`projected daily spend $${spentToday + valueUsd} (already spent $${spentToday} + sell of $${valueUsd.toFixed(2)}) exceeds daily cap $${perDayCapUsd}`);
    }
    const sellBase = { ...base, sizeUsd: Math.round(valueUsd * 100) / 100 };
    const sell = await runLeg("sell", target, BSC_USDT_ADDRESS, amount, pool, wallet, deps);
    if (sell.txId || sell.pendingTxId) recordSpend(valueUsd);
    const capNote = amount < held ? `sell capped at $${EXECUTION_TEST_HARD_CAP_USD_PER_LEG}; run sell_only again for the rest` : undefined;
    return ledger.appendExecutionTest({
      ...sellBase,
      outcome: sell.error ? "sell_failed" : "completed",
      ...(capNote ? { reason: capNote } : {}),
      legs: [sell],
      spendRecordedUsd,
      targetBalanceAfter: await heldAfter(),
    });
  }

  // Round trip. BSC USDT has 18 decimals, and the cap is in USDT, so the
  // buy leg spends at most EXECUTION_TEST_HARD_CAP_USD_PER_LEG.
  const buy = await runLeg("buy", BSC_USDT_ADDRESS, target, parseUnits(sizeUsd.toString(), 18), pool, wallet, deps);
  if (buy.txId || buy.pendingTxId) recordSpend(sizeUsd);
  if (buy.error) {
    return ledger.appendExecutionTest({ ...base, outcome: "buy_failed", legs: [buy], spendRecordedUsd, targetBalanceAfter: await heldAfter() });
  }

  // Sell what the buy actually delivered, re-capped at the current pool
  // price so the sell leg is also worth at most the hard cap.
  const recovery = (held: string | undefined) =>
    `buy leg completed, sell leg failed: the wallet still holds ${held === undefined ? "an unknown amount of" : formatUnits(BigInt(held), targetDecimals)} MSFTB. ` +
    `Recover with POST /api/execution-test ${SELL_ONLY_REQUEST} (live mode).`;
  let sellAmount: bigint;
  let sellPriceUsd: number;
  let capNote: string | undefined;
  try {
    const received = BigInt(buy.received ?? "0");
    sellPriceUsd = (await readPool(pool)).priceUsd;
    const cap = capUnitsAt(sellPriceUsd);
    sellAmount = received < cap ? received : cap;
    if (sellAmount < received) {
      capNote = `sell capped at $${EXECUTION_TEST_HARD_CAP_USD_PER_LEG}: ${formatUnits(received - sellAmount, targetDecimals)} of the bought tokens stay in the wallet`;
    }
    if (sellAmount === 0n) throw new Error("the buy leg delivered no tokens to sell");
  } catch (err) {
    const sell: ExecutionTestLeg = { side: "sell", tokenIn: target, tokenOut: BSC_USDT_ADDRESS, amountIn: "0", error: message(err) };
    const held = await heldAfter();
    return ledger.appendExecutionTest({ ...base, outcome: "sell_failed", reason: recovery(held), legs: [buy, sell], spendRecordedUsd, targetBalanceAfter: held });
  }

  const sell = await runLeg("sell", target, BSC_USDT_ADDRESS, sellAmount, pool, wallet, deps);
  // The sell leg's notional at the pool price read just before it (≤ the cap).
  if (sell.txId || sell.pendingTxId) recordSpend(Number(formatUnits(sellAmount, targetDecimals)) * sellPriceUsd);
  const held = await heldAfter();
  return ledger.appendExecutionTest({
    ...base,
    outcome: sell.error ? "sell_failed" : "completed",
    ...(sell.error ? { reason: recovery(held) } : capNote ? { reason: capNote } : {}),
    legs: [buy, sell],
    spendRecordedUsd,
    targetBalanceAfter: held,
  });
}

// Allowance (approving exactly amountIn if short) → QuoterV2 → swap. Both
// the approval and the swap go through send(), which has Binance simulate
// each transaction and broadcasts it with MEV protection. Returns the leg
// with `error` set instead of throwing, so the ledger shows how far it got.
async function runLeg(
  side: "buy" | "sell",
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  pool: { address: Address; feeUnits: number },
  wallet: Address,
  deps: ExecutionTestDeps
): Promise<ExecutionTestLeg> {
  const getBalance = deps.getBalance ?? getErc20Balance;
  const checkAllowanceFn = deps.checkAllowance ?? checkAllowance;
  const quote = deps.quote ?? simulateSwapOutput;
  const sendFn = deps.send ?? send;
  const tolerance = deps.slippageTolerance ?? DEFAULT_GUARDRAIL_CONFIG.sendSlippageTolerance;
  const leg: ExecutionTestLeg = { side, tokenIn, tokenOut, amountIn: amountIn.toString() };
  let stage: "approval" | "swap" = "approval";

  try {
    const balanceIn = await getBalance(tokenIn, wallet);
    if (balanceIn < amountIn) {
      throw new Error(`insufficient ${tokenIn} balance: have ${balanceIn}, need ${amountIn}`);
    }

    const allowance = await checkAllowanceFn({
      tokenAddress: tokenIn,
      ownerAddress: wallet,
      spenderAddress: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
      amountRequired: amountIn,
    });
    leg.approval = { needed: !allowance.sufficient };
    if (!allowance.sufficient) {
      const approval = await sendFn(allowance.approveTransaction!);
      leg.approval.txId = approval.txId;
      if (approval.orderId) leg.approval.orderId = approval.orderId;
    }
    stage = "swap";

    const { amountOut } = await quote({ tokenIn, tokenOut, amountIn, feeUnits: pool.feeUnits });
    const amountOutMinimum = applySlippageTolerance(amountOut, tolerance);
    leg.quotedAmountOut = amountOut.toString();
    leg.amountOutMinimum = amountOutMinimum.toString();

    const outBefore = await getBalance(tokenOut, wallet);
    const swap = buildExactInputSingleTransaction({
      tokenIn,
      tokenOut,
      feeUnits: pool.feeUnits,
      recipient: wallet,
      amountIn,
      amountOutMinimum,
    });
    const result = await sendFn(swap);
    leg.txId = result.txId;
    if (result.orderId) leg.orderId = result.orderId;
    const simulation = (result.raw as { simulation?: TxSimulation } | undefined)?.simulation;
    if (simulation) leg.transactionSimulation = simulation;

    const outAfter = await getBalance(tokenOut, wallet);
    leg.received = (outAfter - outBefore).toString();
  } catch (err) {
    leg.error = message(err);
    // Broadcast, but the receipt wasn't confirmed: the transaction may
    // still be mined. Keep its hash so the ledger never loses it.
    if (err instanceof SentButUnconfirmedError) {
      const target = stage === "swap" ? leg : leg.approval;
      if (target) {
        target.pendingTxId = err.txHash;
        if (err.orderId) target.orderId = err.orderId;
      }
    }
  }
  return leg;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
