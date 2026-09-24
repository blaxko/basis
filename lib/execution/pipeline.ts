import { parseUnits, formatUnits, type Address } from "viem";
import { check, dryRunFloorCheck, spreadFreshnessCheck, type ProposedOrder, type PoolPair } from "../guardrails/check";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";
import { send, getTradingWalletAddress, type UnsignedTransaction, type SendResult } from "./agentic-wallet";
import {
  checkAllowance,
  simulateSwapOutput,
  buildExactInputSingleTransaction,
  readPoolPrice,
  getErc20Decimals,
  PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
  type AllowanceCheckResult,
} from "../data/pancakeswap-v3";
import { BSC_USDT_ADDRESS } from "../data/quotes";
import { AuditLedger, type AuditLedgerEntry, type PipelineMode } from "./audit-ledger";

export type { PipelineMode } from "./audit-ledger";

// Duplicated from lib/orchestration/agent-loop.ts's DEFAULT_AGENT_LOOP_CONFIG
// rather than imported — importing orchestration/ from execution/ would
// invert the layering (execution sits below orchestration). Same pattern
// as the duplicated UnsignedTransaction interfaces across data/execution.
const DEFAULT_GAS_COST_USD_ESTIMATE = 200_000 * 1.5e-9 * 700;
const DEFAULT_SLIPPAGE_PCT_ESTIMATE = 0.0005;

// A deliberate execution-safety parameter, not a researched/cited fact
// like the SwapRouter address or ABI: the on-chain minimum-output floor
// passed to exactInputSingle, protecting the send() transaction itself
// against price movement between the QuoterV2 simulation and the
// transaction actually landing. Separate from, and in addition to,
// spreadFreshnessCheck (which protects the *decision* to send at all)
// and dryRunFloorCheck (which protects against a stale *guardrail*
// verdict) — this one protects the on-chain call.
const SEND_SLIPPAGE_TOLERANCE_BPS = 100n; // 1%

function applySlippageTolerance(amountOut: bigint): bigint {
  return amountOut - (amountOut * SEND_SLIPPAGE_TOLERANCE_BPS) / 10_000n;
}

export interface FreshPoolPrices {
  cheapPoolPriceUsd: number;
  cheapPoolToken0: Address;
  cheapPoolToken1: Address;
  expensivePoolPriceUsd: number;
  expensivePoolToken0: Address;
  expensivePoolToken1: Address;
}

// Real on-chain re-read of both pools, immediately before send() — the
// MEV/front-running mitigation for bypassing Binance's aggregator (which
// would otherwise have absorbed this risk itself). Injectable so tests
// never need a live RPC endpoint just to exercise the pipeline's control
// flow, same DI pattern as WalletClient below.
async function defaultFetchFreshPoolPrices(poolPair: PoolPair): Promise<FreshPoolPrices> {
  const [cheap, expensive] = await Promise.all([
    readPoolPrice(poolPair.cheapPoolAddress as Address, BSC_USDT_ADDRESS, poolPair.cheapPoolFeeUnits),
    readPoolPrice(poolPair.expensivePoolAddress as Address, BSC_USDT_ADDRESS, poolPair.expensivePoolFeeUnits),
  ]);
  return {
    cheapPoolPriceUsd: cheap.priceUsd,
    cheapPoolToken0: cheap.token0,
    cheapPoolToken1: cheap.token1,
    expensivePoolPriceUsd: expensive.priceUsd,
    expensivePoolToken0: expensive.token0,
    expensivePoolToken1: expensive.token1,
  };
}

function resolveTargetTokenAddress(token0: Address, token1: Address, stablecoin: Address): Address {
  return token0.toLowerCase() === stablecoin.toLowerCase() ? token1 : token0;
}

// A real, direct-pool PancakeSwap V3 swap call — replaces the old
// Binance-aggregator SwapRequest entirely. Built from order.poolPair
// alone (plus the fresh token0/token1 addresses the freshness re-read
// already retrieved), never from lib/data/token-addresses.ts's retired
// xStocks/Ondo registry.
export interface DirectSwapParams {
  tokenIn: Address;
  tokenOut: Address;
  feeUnits: number;
  amountIn: bigint;
  // The pool price used to size amountIn / value the simulated output —
  // carried alongside so callers don't need to re-derive it.
  referencePriceUsd: number;
}

// Only the "buy" side (buy the cheap pool's target token with USDT) is
// implemented against real decimals/amount math — the only side
// lib/orchestration/agent-loop.ts's constructOrder() ever produces today.
// A "sell" order needs the target token's own decimals to size amountIn
// correctly (sizeUsd / price, in the target token's base units, not
// USDT's) — buildable the same way via getErc20Decimals(), but nothing
// in this codebase exercises that path yet, so it throws NotImplemented
// rather than shipping an unexercised, unverified branch (same
// fail-closed/refuse-to-fabricate posture as lib/data/pool-addresses.ts's
// and lib/data/token-addresses.ts's registries).
async function buildDirectSwapParams(order: ProposedOrder, fresh: FreshPoolPrices): Promise<DirectSwapParams> {
  if (order.side !== "buy") {
    throw new Error(
      `NotImplemented: buildDirectSwapParams only handles "buy" orders — order.side was "${order.side}". ` +
        "A sell leg needs the target token's own decimals to size amountIn correctly; not built until a real sell order exercises this path."
    );
  }

  const tokenOut = resolveTargetTokenAddress(fresh.cheapPoolToken0, fresh.cheapPoolToken1, BSC_USDT_ADDRESS);
  // BSC USDT is confirmed 18 decimals (not mainnet USDT's 6) — verified
  // on-chain this session, see lib/data/pool-addresses.ts's pool comments.
  const amountIn = parseUnits(order.sizeUsd.toString(), 18);

  return {
    tokenIn: BSC_USDT_ADDRESS,
    tokenOut,
    feeUnits: order.poolPair.cheapPoolFeeUnits,
    amountIn,
    referencePriceUsd: fresh.cheapPoolPriceUsd,
  };
}

export interface SimulateSwapResult {
  outputUsd: number;
  amountOut: bigint;
  gasEstimate: bigint;
}

// Injectable so callers (and tests) can swap in mocks without needing a
// live RPC endpoint or funded wallet — defaults to real on-chain calls
// against PancakeSwap V3 directly (QuoterV2 for simulation, the pure
// SwapRouter for allowance/send), never Binance's aggregator. Replaces
// the old Binance-aggregator-shaped WalletClient (approvalCheck(request:
// SwapRequest)/dryRun(request: SwapRequest)) entirely.
export interface WalletClient {
  checkAllowance(params: {
    tokenAddress: Address;
    ownerAddress: Address;
    spenderAddress: Address;
    amountRequired: bigint;
  }): Promise<AllowanceCheckResult>;
  simulateSwap(params: DirectSwapParams): Promise<SimulateSwapResult>;
  // Takes an unsigned transaction (from checkAllowance()'s
  // approveTransaction or send()'s own built transaction), not the
  // original order — same shape/reasoning as before.
  send(unsignedTransaction: UnsignedTransaction): Promise<SendResult>;
}

async function defaultSimulateSwap(params: DirectSwapParams): Promise<SimulateSwapResult> {
  const { amountOut, gasEstimate } = await simulateSwapOutput({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    feeUnits: params.feeUnits,
  });
  const tokenOutDecimals = await getErc20Decimals(params.tokenOut);
  // Approximation, same status as the old simulatedOutputUsd modeled
  // input: converts the simulated output back to USD using the
  // just-read spot price, not a second on-chain price lookup for the
  // simulated fill itself.
  const outputUsd = Number(formatUnits(amountOut, tokenOutDecimals)) * params.referencePriceUsd;
  return { outputUsd, amountOut, gasEstimate };
}

const defaultWalletClient: WalletClient = {
  checkAllowance,
  simulateSwap: defaultSimulateSwap,
  send,
};

export interface PipelineDeps {
  spentTodaySoFarUsd: number;
  config?: GuardrailConfig;
  walletClient?: WalletClient;
  ledger?: AuditLedger;
  fetchFreshPoolPrices?: (poolPair: PoolPair) => Promise<FreshPoolPrices>;
  buildDirectSwapParams?: (order: ProposedOrder, fresh: FreshPoolPrices) => Promise<DirectSwapParams>;
  gasCostUsdEstimate?: number;
  slippagePctEstimate?: number;
  // Injectable so tests never need real TRADING_WALLET_PRIVATE_KEY/
  // BSC_RPC_URL credentials configured just to exercise the pipeline's
  // control flow past the freshness check — same DI pattern as
  // walletClient. Defaults to the real trading wallet's address.
  getWalletAddress?: () => string;
}

// ---------------------------------------------------------------------
// RETIRED: the Binance-aggregator-based approve/dryRun/send path that
// used to live in this file (SwapRequest, approvalCheck(), dryRun()
// keyed on fromTokenAddress/toTokenAddress/vendor). Not deleted from
// lib/execution/agentic-wallet.ts — approvalCheck()/dryRun() are still
// exported there — because Binance's aggregator quote is a real
// independent best-price reference that could have future value as a
// no-arb sanity oracle to cross-check pool-detected spreads against
// (idea flagged, not built). It's simply no longer wired into
// runPipeline() below: the live-execution path now goes direct to a
// specific PancakeSwap V3 pool, which is the entire point of this
// mechanism (bypassing the aggregator's auto-routing, which erases the
// cross-pool gap for normal users).
// ---------------------------------------------------------------------

// Thin orchestrator: decides nothing itself. Calls the Phase 2 gate,
// and only acts on an approved verdict — never re-derives or overrides
// its decision. `mode` gates how far an approved order is allowed to
// go, standing in for the killswitch until Phase 5 wires a UI to it:
//
//   "simulation" — stops after the guardrail verdict; no wallet/RPC call at all.
//   "dry-run"    — re-reads both pools fresh and runs spreadFreshnessCheck
//                  (fails closed as "spread_closed" if the edge decayed
//                  or inverted since detection), then checks allowance
//                  and simulates via QuoterV2, re-checking the same floor
//                  the gate already validated — but never calls send(),
//                  not even for a needed approval. This is the default:
//                  mode must be passed explicitly to reach "live" (PRD rule 9).
//   "live"       — same freshness re-check and simulation. If an
//                  approval is needed, sends that transaction first and
//                  stops (outcome "approval_failed") if it fails. Only on
//                  a passing simulation does the swap's send() fire.
//
// Every outcome — blocked, error, simulated, a closed/decayed spread, a
// failed approval, a failed simulation, a dry-run-only stop, an
// execution, or a failed send — writes exactly one audit ledger entry
// (PRD rule 8). A correctly-declined trade (blocked, spread_closed,
// dry_run_failed) is a fully valid, well-logged outcome — never treated
// as lesser than an execution.
export async function runPipeline(
  order: ProposedOrder,
  deps: PipelineDeps,
  mode: PipelineMode = "dry-run"
): Promise<AuditLedgerEntry> {
  const config = deps.config ?? DEFAULT_GUARDRAIL_CONFIG;
  const walletClient = deps.walletClient ?? defaultWalletClient;
  const ledger = deps.ledger ?? new AuditLedger();
  const fetchFreshPoolPricesFn = deps.fetchFreshPoolPrices ?? defaultFetchFreshPoolPrices;
  const buildDirectSwapParamsFn = deps.buildDirectSwapParams ?? buildDirectSwapParams;
  const getWalletAddressFn = deps.getWalletAddress ?? getTradingWalletAddress;
  const gasCostUsdEstimate = deps.gasCostUsdEstimate ?? DEFAULT_GAS_COST_USD_ESTIMATE;
  const slippagePctEstimate = deps.slippagePctEstimate ?? DEFAULT_SLIPPAGE_PCT_ESTIMATE;

  const verdict = check(order, { spentTodaySoFarUsd: deps.spentTodaySoFarUsd, config });

  if (!verdict.approved) {
    return ledger.append({
      mode,
      outcome: verdict.status === "error" ? "error" : "blocked",
      verdict,
    });
  }

  if (mode === "simulation") {
    return ledger.append({ mode, outcome: "simulated", verdict });
  }

  const fresh = await fetchFreshPoolPricesFn(order.poolPair);

  const effectiveBuyPriceUsd = feeAdjustedPrice(fresh.cheapPoolPriceUsd, order.poolPair.cheapPoolFeeUnits, "buy");
  const effectiveSellPriceUsd = feeAdjustedPrice(fresh.expensivePoolPriceUsd, order.poolPair.expensivePoolFeeUnits, "sell");
  const freshSpread = adjustedSpread({
    effectiveBuyPriceUsd,
    effectiveSellPriceUsd,
    slippagePct: slippagePctEstimate,
    gasCostUsd: gasCostUsdEstimate,
    tradeSizeUsd: order.sizeUsd,
  });

  const freshnessResult = spreadFreshnessCheck(order.adjustedSpread, freshSpread, config);
  if (!freshnessResult.ok) {
    return ledger.append({
      mode,
      outcome: "spread_closed",
      verdict,
      freshness: { freshSpread, ok: false, reason: freshnessResult.reason },
    });
  }

  const swapParams = await buildDirectSwapParamsFn(order, fresh);
  const walletAddress = getWalletAddressFn() as Address;

  const allowance = await walletClient.checkAllowance({
    tokenAddress: swapParams.tokenIn,
    ownerAddress: walletAddress,
    spenderAddress: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
    amountRequired: swapParams.amountIn,
  });
  let approvalInfo: { needed: boolean; txId?: string } = { needed: !allowance.sufficient };

  if (!allowance.sufficient && mode === "live") {
    try {
      const approvalSendResult = await walletClient.send(allowance.approveTransaction!);
      // Approval succeeded — fall through to the swap's simulate/send
      // below, carrying its txId into whichever entry gets appended.
      approvalInfo = { needed: true, txId: approvalSendResult.txId };
    } catch (err) {
      return ledger.append({
        mode,
        outcome: "approval_failed",
        verdict,
        freshness: { freshSpread, ok: true },
        approval: { needed: true, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const simulated = await walletClient.simulateSwap(swapParams);

  // Belt-and-suspenders: reuse the gate's own floor check rather than
  // reimplementing the threshold math, against the freshly-simulated
  // output instead of the modeled simulatedOutputUsd the gate saw.
  const floorCheck = dryRunFloorCheck({ ...order, simulatedOutputUsd: simulated.outputUsd }, config);

  if (!floorCheck.ok) {
    return ledger.append({
      mode,
      outcome: "dry_run_failed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun: { outputUsd: simulated.outputUsd, ok: false, reason: floorCheck.reason },
    });
  }

  if (mode === "dry-run") {
    return ledger.append({
      mode,
      outcome: "dry_run_only",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun: { outputUsd: simulated.outputUsd, ok: true },
    });
  }

  const unsignedTransaction = buildExactInputSingleTransaction({
    tokenIn: swapParams.tokenIn,
    tokenOut: swapParams.tokenOut,
    feeUnits: swapParams.feeUnits,
    recipient: walletAddress,
    amountIn: swapParams.amountIn,
    amountOutMinimum: applySlippageTolerance(simulated.amountOut),
  });

  try {
    const sendResult = await walletClient.send(unsignedTransaction);
    return ledger.append({
      mode,
      outcome: "executed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun: { outputUsd: simulated.outputUsd, ok: true },
      send: { txId: sendResult.txId },
    });
  } catch (err) {
    return ledger.append({
      mode,
      outcome: "send_failed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun: { outputUsd: simulated.outputUsd, ok: true },
      send: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
