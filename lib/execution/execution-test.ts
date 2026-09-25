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
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import { isPublicReadOnly } from "../config/deployment";
import { send, getTradingWalletAddress, type SendResult, type UnsignedTransaction } from "./agentic-wallet";
import { applySlippageTolerance } from "./pipeline";
import {
  defaultLedger,
  type AuditLedger,
  type ExecutionTestLedgerEntry,
  type ExecutionTestLeg,
  type PipelineMode,
} from "./audit-ledger";
import type { TxSimulation } from "../data/binance-transaction";

// A MANUAL execution test, not arbitrage: buy a few dollars of MSFTB on
// the 0.25% pool, then sell what was received back into the same pool.
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

const POOL_FEE_UNITS = 2500; // the 0.25% MSFTB/USDT pool

function testPool(): { address: Address; feeUnits: number } {
  const pool = getPoolsForTicker("MSFT").find((p) => p.feeUnits === POOL_FEE_UNITS);
  if (!pool) throw new Error("the 0.25% MSFTB pool is not registered in lib/data/pool-addresses.ts");
  return { address: pool.address as Address, feeUnits: pool.feeUnits };
}

export interface ExecutionTestRequest {
  sizeUsd: number;
  // Must be literally true. Nothing defaults it.
  confirm: boolean;
}

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

// One run at a time per process. On globalThis like the other shared
// state, so a second bundle can't start a concurrent run.
const IN_FLIGHT_KEY = Symbol.for("basis.executionTest.inFlight");
const inFlight = globalThis as unknown as Record<symbol, boolean | undefined>;

export async function runExecutionTest(request: ExecutionTestRequest, deps: ExecutionTestDeps): Promise<ExecutionTestLedgerEntry> {
  const ledger = deps.ledger ?? defaultLedger;
  const mode = deps.getKillswitchMode();
  const pool = testPool();
  const sizeUsd = request.sizeUsd;
  const base = { mode, sizeUsd, pool };
  const refuse = (reason: string) => ledger.appendExecutionTest({ ...base, outcome: "refused", reason, legs: [], spendRecordedUsd: 0 });
  const perDayCapUsd = deps.perDayCapUsd ?? DEFAULT_GUARDRAIL_CONFIG.perDayCapUsd;

  if (isPublicReadOnly()) return refuse("PUBLIC_READ_ONLY: the execution test runs locally only, never on a public deployment");
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) return refuse(`sizeUsd must be a positive number (got ${sizeUsd})`);
  if (sizeUsd > EXECUTION_TEST_HARD_CAP_USD_PER_LEG) {
    return refuse(`sizeUsd $${sizeUsd} exceeds the hard cap of $${EXECUTION_TEST_HARD_CAP_USD_PER_LEG} per leg`);
  }
  if (request.confirm !== true) return refuse("explicit confirmation missing: the request must include confirm: true");
  if (mode !== "live") return refuse(`the killswitch is "${mode}"; the execution test sends real transactions and runs only in "live"`);
  // Both legs count toward the daily cap, so both must fit before the
  // first one is sent. Same comparison as the guardrail's dailyCapCheck.
  const spentToday = deps.spendTracker.getSpentToday();
  const projected = spentToday + 2 * sizeUsd;
  if (projected > perDayCapUsd) {
    return refuse(
      `projected daily spend $${projected} (already spent $${spentToday} + two legs of $${sizeUsd}) exceeds daily cap $${perDayCapUsd}`
    );
  }
  if (inFlight[IN_FLIGHT_KEY]) return refuse("another execution test is already running");

  inFlight[IN_FLIGHT_KEY] = true;
  try {
    return await runLegs(sizeUsd, pool, deps, ledger, base);
  } finally {
    inFlight[IN_FLIGHT_KEY] = false;
  }
}

async function runLegs(
  sizeUsd: number,
  pool: { address: Address; feeUnits: number },
  deps: ExecutionTestDeps,
  ledger: AuditLedger,
  base: Pick<ExecutionTestLedgerEntry, "mode" | "sizeUsd" | "pool">
): Promise<ExecutionTestLedgerEntry> {
  const readPool = deps.readPool ?? ((p) => readPoolPrice(p.address, BSC_USDT_ADDRESS, p.feeUnits));
  const getDecimals = deps.getDecimals ?? getErc20Decimals;
  const getNativeBalance = deps.getNativeBalance ?? ((owner) => getPublicClient().getBalance({ address: owner }));

  // A leg's notional counts once its swap is mined — the pipeline's rule
  // too (it records spend only for an "executed" order).
  let spendRecordedUsd = 0;
  const recordSpend = (usd: number) => {
    deps.spendTracker.recordSpend(usd);
    spendRecordedUsd += usd;
  };

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
      return ledger.appendExecutionTest({
        ...base,
        outcome: "refused",
        reason: `trading wallet holds ${formatUnits(bnb, 18)} BNB; at least ${formatUnits(EXECUTION_TEST_MIN_BNB_WEI, 18)} BNB is required for gas`,
        legs: [],
        spendRecordedUsd,
      });
    }
  } catch (err) {
    return ledger.appendExecutionTest({ ...base, outcome: "refused", reason: message(err), legs: [], spendRecordedUsd });
  }

  // BSC USDT has 18 decimals, and the cap is in USDT, so the buy leg
  // spends at most EXECUTION_TEST_HARD_CAP_USD_PER_LEG.
  const buy = await runLeg("buy", BSC_USDT_ADDRESS, target, parseUnits(sizeUsd.toString(), 18), pool, wallet, deps);
  if (buy.txId) recordSpend(sizeUsd);
  if (buy.error) return ledger.appendExecutionTest({ ...base, outcome: "buy_failed", legs: [buy], spendRecordedUsd });

  // Sell what the buy actually delivered, re-capped at the current pool
  // price so the sell leg is also worth at most the hard cap. Anything
  // above the cap stays in the wallet and is reported.
  let sellAmount: bigint;
  let sellPriceUsd: number;
  let capNote: string | undefined;
  try {
    const received = BigInt(buy.received ?? "0");
    const { priceUsd } = await readPool(pool);
    sellPriceUsd = priceUsd;
    const capTokens = Math.floor((EXECUTION_TEST_HARD_CAP_USD_PER_LEG / priceUsd) * 1e12) / 1e12;
    const capUnits = parseUnits(capTokens.toFixed(12), targetDecimals);
    sellAmount = received < capUnits ? received : capUnits;
    if (sellAmount < received) {
      capNote = `sell capped at $${EXECUTION_TEST_HARD_CAP_USD_PER_LEG}: ${formatUnits(received - sellAmount, targetDecimals)} of the bought tokens stay in the wallet`;
    }
    if (sellAmount === 0n) throw new Error("the buy leg delivered no tokens to sell");
  } catch (err) {
    const sell: ExecutionTestLeg = { side: "sell", tokenIn: target, tokenOut: BSC_USDT_ADDRESS, amountIn: "0", error: message(err) };
    return ledger.appendExecutionTest({ ...base, outcome: "sell_failed", legs: [buy, sell], spendRecordedUsd });
  }

  const sell = await runLeg("sell", target, BSC_USDT_ADDRESS, sellAmount, pool, wallet, deps);
  // The sell leg's notional at the pool price read just before it (≤ the cap).
  if (sell.txId) recordSpend(Number(formatUnits(sellAmount, targetDecimals)) * sellPriceUsd);
  return ledger.appendExecutionTest({
    ...base,
    outcome: sell.error ? "sell_failed" : "completed",
    ...(capNote ? { reason: capNote } : {}),
    legs: [buy, sell],
    spendRecordedUsd,
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
    }

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
    const simulation = (result.raw as { simulation?: TxSimulation } | undefined)?.simulation;
    if (simulation) leg.transactionSimulation = simulation;

    const outAfter = await getBalance(tokenOut, wallet);
    leg.received = (outAfter - outBefore).toString();
  } catch (err) {
    leg.error = message(err);
  }
  return leg;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
