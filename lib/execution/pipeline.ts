import { parseUnits, formatUnits, type Address } from "viem";
import {
  check,
  dryRunFloorCheck,
  spreadFreshnessCheck,
  slippageToleranceCheck,
  type ProposedOrder,
  type PoolPair,
} from "../guardrails/check";
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
import { simulateEvmTransaction, type EvmTxToSimulate, type TxSimulation } from "../data/binance-transaction";
import { AuditLedger, type PipelineLedgerEntry, type DetectionSnapshot, type PipelineMode } from "./audit-ledger";

export type { PipelineMode } from "./audit-ledger";

// Used only when a caller doesn't pass the gas figure its detection used.
// Duplicated from lib/orchestration/agent-loop.ts's fallback rather than
// imported — importing orchestration/ from execution/ would invert the
// layering. Same pattern as the duplicated UnsignedTransaction interfaces.
const DEFAULT_GAS_COST_USD_ESTIMATE = 200_000 * 1.5e-9 * 700;
const DEFAULT_SLIPPAGE_PCT_ESTIMATE = 0.0005;

// The swap's on-chain minimum output: QuoterV2's simulated output less
// config.sendSlippageTolerance. Protects the transaction itself against
// movement between simulation and inclusion; slippageToleranceCheck
// refuses any order whose edge this floor couldn't protect.
export function applySlippageTolerance(amountOut: bigint, tolerance: number): bigint {
  const ppm = BigInt(Math.round(tolerance * 1_000_000));
  return amountOut - (amountOut * ppm) / 1_000_000n;
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
  // Binance Transaction API simulate on the exact unsigned swap we'd send.
  simulateWithBinance(evmTx: EvmTxToSimulate): Promise<TxSimulation>;
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
  simulateWithBinance: (evmTx) => simulateEvmTransaction(evmTx),
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
  // Attached to every ledger entry this run writes, so an automatic
  // order's row shows the pool readings it was built from.
  detection?: DetectionSnapshot;
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
// its decision. `mode` gates how far an approved order is allowed to go:
//
//   (all modes)  — an approved order whose detected net edge is not
//                  positive stops as "no_edge"; one whose edge the
//                  on-chain slippage floor couldn't protect stops as
//                  "tolerance_exceeds_edge". Nothing is sent.
//   "simulation" — stops after those gates; no wallet/RPC call at all.
//   "dry-run"    — re-reads both pools fresh and runs spreadFreshnessCheck
//                  (fails closed as "spread_closed" if the edge decayed
//                  or inverted since detection), then checks allowance
//                  and simulates via QuoterV2, re-checking the dry-run
//                  floor on the real output, then has Binance's
//                  Transaction API simulate the exact swap transaction
//                  from our wallet ("dry_run_failed" unless it predicts
//                  success) — but never calls send(), not even for a
//                  needed approval. This is the default.
//   "live"       — refuses as "two_leg_execution_not_implemented" before
//                  any re-read, approval, or send. Only the buy leg is
//                  built; a single leg alone doesn't capture the spread,
//                  so live mode can't send one. See executeDirectSwap.
//
// Every outcome writes exactly one audit ledger entry (PRD rule 8). A
// correctly-declined trade is a fully valid, well-logged outcome — never
// treated as lesser than an execution.
export async function runPipeline(
  order: ProposedOrder,
  deps: PipelineDeps,
  mode: PipelineMode = "dry-run"
): Promise<PipelineLedgerEntry> {
  return runSteps(order, deps, mode, { allowSend: false });
}

// The single-leg approval → simulation → send path, built and tested but
// NOT reachable from runPipeline in any mode. It stays unwired until
// two-leg execution exists; test/architecture.test.ts fails if anything
// outside lib/execution/pipeline*.ts references it.
export async function executeDirectSwap(order: ProposedOrder, deps: PipelineDeps): Promise<PipelineLedgerEntry> {
  return runSteps(order, deps, "live", { allowSend: true });
}

async function runSteps(
  order: ProposedOrder,
  deps: PipelineDeps,
  mode: PipelineMode,
  { allowSend }: { allowSend: boolean }
): Promise<PipelineLedgerEntry> {
  const config = deps.config ?? DEFAULT_GUARDRAIL_CONFIG;
  const walletClient = deps.walletClient ?? defaultWalletClient;
  const ledger = deps.ledger ?? new AuditLedger();
  const record = (entry: Parameters<AuditLedger["append"]>[0]) =>
    ledger.append(deps.detection ? { ...entry, detection: deps.detection } : entry);
  const fetchFreshPoolPricesFn = deps.fetchFreshPoolPrices ?? defaultFetchFreshPoolPrices;
  const buildDirectSwapParamsFn = deps.buildDirectSwapParams ?? buildDirectSwapParams;
  const getWalletAddressFn = deps.getWalletAddress ?? getTradingWalletAddress;
  const gasCostUsdEstimate = deps.gasCostUsdEstimate ?? DEFAULT_GAS_COST_USD_ESTIMATE;
  const slippagePctEstimate = deps.slippagePctEstimate ?? DEFAULT_SLIPPAGE_PCT_ESTIMATE;

  const verdict = check(order, { spentTodaySoFarUsd: deps.spentTodaySoFarUsd, config });

  if (!verdict.approved) {
    return record({
      mode,
      outcome: verdict.status === "error" ? "error" : "blocked",
      verdict,
    });
  }

  // Runs after the guardrails on purpose, so an oversized manual request
  // is still reported as a guardrail block. Keeps spread_closed meaning
  // strictly "a positive edge decayed before send".
  if (order.adjustedSpread <= 0) {
    return record({ mode, outcome: "no_edge", verdict });
  }

  const detectedTolerance = slippageToleranceCheck(order.adjustedSpread, config);
  if (!detectedTolerance.ok) {
    return record({ mode, outcome: "tolerance_exceeds_edge", verdict });
  }

  if (mode === "simulation") {
    return record({ mode, outcome: "simulated", verdict });
  }

  if (mode === "live" && !allowSend) {
    return record({ mode, outcome: "two_leg_execution_not_implemented", verdict });
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
    return record({
      mode,
      outcome: "spread_closed",
      verdict,
      freshness: { freshSpread, ok: false, reason: freshnessResult.reason },
    });
  }

  // The fresh edge can have decayed to half the detected one and still
  // pass spreadFreshness — check the slippage floor against it too.
  const freshTolerance = slippageToleranceCheck(freshSpread, config);
  if (!freshTolerance.ok) {
    return record({
      mode,
      outcome: "tolerance_exceeds_edge",
      verdict,
      freshness: { freshSpread, ok: true },
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

  if (!allowance.sufficient && allowSend) {
    try {
      const approvalSendResult = await walletClient.send(allowance.approveTransaction!);
      // Approval succeeded — fall through to the swap's simulate/send
      // below, carrying its txId into whichever entry gets appended.
      approvalInfo = { needed: true, txId: approvalSendResult.txId };
    } catch (err) {
      return record({
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
    return record({
      mode,
      outcome: "dry_run_failed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun: { outputUsd: simulated.outputUsd, ok: false, reason: floorCheck.reason },
    });
  }

  const unsignedTransaction = buildExactInputSingleTransaction({
    tokenIn: swapParams.tokenIn,
    tokenOut: swapParams.tokenOut,
    feeUnits: swapParams.feeUnits,
    recipient: walletAddress,
    amountIn: swapParams.amountIn,
    amountOutMinimum: applySlippageTolerance(simulated.amountOut, config.sendSlippageTolerance),
  });

  // QuoterV2 prices the pool; Binance simulates the actual transaction
  // from our wallet (balance, allowance, minimum-output floor). Only a
  // predicted success passes. Binance simulates one transaction at a
  // time, so while an approval is still needed the swap is predicted to
  // revert ("STF") — reported as it is, not skipped.
  const transactionSimulation = await walletClient.simulateWithBinance({
    from: walletAddress,
    to: unsignedTransaction.to,
    value: unsignedTransaction.value ?? "0",
    data: unsignedTransaction.data,
  });
  const dryRun = { outputUsd: simulated.outputUsd, ok: true };

  if (transactionSimulation.result !== "succeeded") {
    return record({
      mode,
      outcome: "dry_run_failed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun,
      transactionSimulation,
    });
  }

  if (!allowSend) {
    return record({
      mode,
      outcome: "dry_run_only",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun,
      transactionSimulation,
    });
  }

  try {
    const sendResult = await walletClient.send(unsignedTransaction);
    return record({
      mode,
      outcome: "executed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun,
      transactionSimulation,
      send: { txId: sendResult.txId },
    });
  } catch (err) {
    return record({
      mode,
      outcome: "send_failed",
      verdict,
      freshness: { freshSpread, ok: true },
      approval: approvalInfo,
      dryRun,
      transactionSimulation,
      send: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
