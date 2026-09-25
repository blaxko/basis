import { fetchPoolQuotes as realFetchPoolQuotes, BSC_USDT_ADDRESS } from "../data/quotes";
import { getRegisteredTickers } from "../data/pool-addresses";
import { defaultPriceHistory, type PriceHistory } from "../data/price-history";
import { estimateRoundTripGasUsd, getTargetTokenOnChain, type GasEstimate, type RoundTripGasParams } from "../data/gas-estimate";
import { fetchAggregatorReference, type ReferenceQuote } from "../data/binance-reference";
import { getTradingWalletAddress } from "../execution/agentic-wallet";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { rawSpread, adjustedSpread as computeAdjustedSpread } from "../basis-model/adjusted-spread";
import { runPipeline, type WalletClient, type PipelineDeps } from "../execution/pipeline";
import {
  AuditLedger,
  defaultLedger,
  type DetectionSnapshot,
  type PipelineMode,
  type PipelineOutcome,
} from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import { check, type ProposedOrder, type GuardrailVerdict, type PoolPair } from "../guardrails/check";
import { narrateProposal as realNarrateProposal } from "../llm/proposal-narrator";
import { defaultSpendTracker, type SpendTracker } from "./spend-tracker";
import { getKillswitchMode } from "./killswitch";

// This is the one module allowed to import across lib/llm/, lib/guardrails/,
// and lib/execution/ in the same file (Phase 5a only) — it sits above all
// three. The invariant that survives from Phase 4 is NOT about imports
// here, it's about data flow: LLM output (narration, or — in
// handle-instruction.ts — OrderIntent) never reaches the wallet except
// through runPipeline()/check(), and the LLM is never trusted to supply
// any of the market-derived numeric fields below (price, liquidity,
// adjusted spread) — those always come from lib/data + lib/basis-model.

export interface PoolLeg {
  address: string;
  priceUsd: number;
  feeUnits: number;
  liquidityUsdEstimate: number;
}

// One ticker's cheapest and most expensive known pool, and the spread
// between them. rawSpread is diagnostic-only (never an execution signal);
// adjustedSpread is the net edge after both pools' fees, estimated
// slippage, and gas — `gas` records which gas figure went into it.
export interface UnderlyingSpread {
  ticker: string;
  cheapPool: PoolLeg;
  expensivePool: PoolLeg;
  rawSpread: number;
  adjustedSpread: number;
  gas: { costUsd: number; source: "live" | "fallback" };
}

export interface TriggeredOpportunity {
  ticker: string;
  order: ProposedOrder;
  narration: string;
  verdict: GuardrailVerdict;
  outcome: PipelineOutcome;
  ledgerEntryId: string;
}

export interface NoOpportunityRecord {
  ticker: string;
  netEdge: number;
  ledgerEntryId: string;
}

export interface WarmUpStatus {
  readings: number;
  required: number;
  complete: boolean;
}

export interface WarmingUpRecord extends WarmUpStatus {
  ticker: string;
  ledgerEntryId: string;
}

export interface AgentLoopResult {
  timestamp: number;
  mode: PipelineMode;
  spreads: UnderlyingSpread[];
  triggered: TriggeredOpportunity[];
  noOpportunities: NoOpportunityRecord[];
  warmingUp: WarmingUpRecord[];
}

export interface AgentLoopConfig {
  underlyings: readonly string[];
  // An order is built only when the net edge (after fees, slippage, and
  // gas) is positive AND strictly above this. Kept as a small epsilon so
  // floating-point dust never becomes an order; see
  // docs/config-rationale.md for why it isn't larger.
  adjustedSpreadThreshold: number;
  orderSizeUsd: number;
  // Live round-trip gas (lib/data/gas-estimate.ts) is multiplied by this.
  // See docs/config-rationale.md.
  gasSafetyMultiplier: number;
  // Used only when the live estimate fails (logged when it happens):
  // ~200k gas × 1.5 gwei × $700 BNB, ~30× the live figure measured
  // 2026-09-24, so it errs toward declining.
  fallbackGasCostUsd: number;
  slippagePctEstimate: number;
}

// Only tickers with at least two registered pools — a ticker without
// them can't have a cross-pool spread, and evaluating it alongside
// others would fail the whole batch.
export const DEFAULT_AGENT_LOOP_CONFIG: AgentLoopConfig = {
  underlyings: getRegisteredTickers(),
  adjustedSpreadThreshold: 0.0001,
  orderSizeUsd: 200,
  gasSafetyMultiplier: 2,
  fallbackGasCostUsd: 200_000 * 1.5e-9 * 700,
  slippagePctEstimate: 0.0005,
};

export type EstimateGasFn = (params: RoundTripGasParams) => Promise<GasEstimate>;

// Binance's aggregator quote for buying the ticker's token with USDT at
// `sizeUsd`. Never throws: any failure comes back as "unavailable" and
// the referencePrice guardrail fails closed on it.
export type FetchReferenceFn = (params: { ticker: string; cheapPoolAddress: string; sizeUsd: number }) => Promise<ReferenceQuote>;

export const defaultFetchReference: FetchReferenceFn = async ({ cheapPoolAddress, sizeUsd }) => {
  let targetToken;
  try {
    targetToken = (await getTargetTokenOnChain(cheapPoolAddress, BSC_USDT_ADDRESS)).address;
  } catch (err) {
    return { status: "unavailable", reason: `couldn't resolve the pool's token: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  let userWalletAddress: string | undefined;
  try {
    userWalletAddress = getTradingWalletAddress(); // public address; bStock RFQ routes require it
  } catch {
    userWalletAddress = undefined;
  }
  return fetchAggregatorReference({ stablecoin: BSC_USDT_ADDRESS, targetToken, sizeUsd, userWalletAddress });
};

// Steps 1–2: pull live per-pool prices and compute the net cross-pool
// edge per underlying via the Basis Model. Writes nothing — this is what
// GET /api/opportunities calls, and a GET must never trigger a pipeline
// run or feed the price history.
export async function computeSpreads(deps: {
  underlyings?: readonly string[];
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  estimateGasFn?: EstimateGasFn;
  gasSafetyMultiplier?: number;
  fallbackGasCostUsd?: number;
  slippagePctEstimate?: number;
  tradeSizeUsd?: number;
} = {}): Promise<UnderlyingSpread[]> {
  const underlyings = deps.underlyings ?? DEFAULT_AGENT_LOOP_CONFIG.underlyings;
  const fetchPoolQuotesFn = deps.fetchPoolQuotesFn ?? realFetchPoolQuotes;
  const estimateGasFn = deps.estimateGasFn ?? ((params: RoundTripGasParams) => estimateRoundTripGasUsd(params));
  const gasSafetyMultiplier = deps.gasSafetyMultiplier ?? DEFAULT_AGENT_LOOP_CONFIG.gasSafetyMultiplier;
  const fallbackGasCostUsd = deps.fallbackGasCostUsd ?? DEFAULT_AGENT_LOOP_CONFIG.fallbackGasCostUsd;
  const slippagePctEstimate = deps.slippagePctEstimate ?? DEFAULT_AGENT_LOOP_CONFIG.slippagePctEstimate;
  const tradeSizeUsd = deps.tradeSizeUsd ?? DEFAULT_AGENT_LOOP_CONFIG.orderSizeUsd;

  return Promise.all(
    underlyings.map(async (ticker): Promise<UnderlyingSpread> => {
      const pools = await fetchPoolQuotesFn(ticker);
      if (pools.length < 2) {
        throw new Error(`need at least 2 known pools to compute a cross-pool spread for ${ticker}, found ${pools.length}`);
      }

      const sorted = [...pools].sort((a, b) => a.priceUsd - b.priceUsd);
      const cheapQuote = sorted[0]!;
      const expensiveQuote = sorted[sorted.length - 1]!;

      const cheapPool: PoolLeg = {
        address: cheapQuote.poolAddress,
        priceUsd: cheapQuote.priceUsd,
        feeUnits: cheapQuote.feeUnits,
        liquidityUsdEstimate: cheapQuote.liquidityUsdEstimate,
      };
      const expensivePool: PoolLeg = {
        address: expensiveQuote.poolAddress,
        priceUsd: expensiveQuote.priceUsd,
        feeUnits: expensiveQuote.feeUnits,
        liquidityUsdEstimate: expensiveQuote.liquidityUsdEstimate,
      };

      const gasEstimate = await estimateGasFn({
        stablecoin: BSC_USDT_ADDRESS,
        cheapPool,
        expensivePool,
        tradeSizeUsd,
        safetyMultiplier: gasSafetyMultiplier,
        fallbackGasCostUsd,
      });

      const raw = rawSpread(cheapPool.priceUsd, expensivePool.priceUsd);
      const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPool.priceUsd, cheapPool.feeUnits, "buy");
      const effectiveSellPriceUsd = feeAdjustedPrice(expensivePool.priceUsd, expensivePool.feeUnits, "sell");
      const adjusted = computeAdjustedSpread({
        effectiveBuyPriceUsd,
        effectiveSellPriceUsd,
        slippagePct: slippagePctEstimate,
        gasCostUsd: gasEstimate.gasCostUsd,
        tradeSizeUsd,
      });

      return {
        ticker,
        cheapPool,
        expensivePool,
        rawSpread: raw,
        adjustedSpread: adjusted,
        gas: { costUsd: gasEstimate.gasCostUsd, source: gasEstimate.source },
      };
    })
  );
}

// Readings available for the pair — the shorter of the two pools'
// histories, since a spike on either side can fake an edge.
export function warmUpStatus(spread: UnderlyingSpread, history: PriceHistory, required: number): WarmUpStatus {
  const readings = Math.min(history.recent(spread.cheapPool.address).length, history.recent(spread.expensivePool.address).length);
  return { readings, required, complete: readings >= required };
}

// Step 3: deterministic order construction — never the LLM's job for
// this automatic path. The order represents buying on the cheap pool;
// poolPair carries both legs' identity so downstream (the freshness
// re-check, buildDirectSwapParams()) knows exactly which two pools this
// order refers to. KNOWN SIMPLIFICATION: only this buy leg is built, so
// live mode refuses to send it (lib/execution/pipeline.ts,
// "two_leg_execution_not_implemented") until two-leg execution exists.
function constructOrder(
  spread: UnderlyingSpread,
  config: AgentLoopConfig,
  history: PriceHistory,
  reference: ReferenceQuote
): ProposedOrder {
  const poolPair: PoolPair = {
    cheapPoolAddress: spread.cheapPool.address,
    cheapPoolFeeUnits: spread.cheapPool.feeUnits,
    expensivePoolAddress: spread.expensivePool.address,
    expensivePoolFeeUnits: spread.expensivePool.feeUnits,
  };

  return {
    ticker: spread.ticker,
    side: "buy",
    sizeUsd: config.orderSizeUsd,
    adjustedSpread: spread.adjustedSpread,
    price: spread.cheapPool.priceUsd,
    recentTicks: history.recent(spread.cheapPool.address),
    expensivePrice: spread.expensivePool.priceUsd,
    expensiveRecentTicks: history.recent(spread.expensivePool.address),
    liquidityDepthUsd: Math.min(spread.cheapPool.liquidityUsdEstimate, spread.expensivePool.liquidityUsdEstimate),
    // No simulation has run yet; check() reports the floor as pending and
    // the pipeline checks it against the real QuoterV2 output.
    simulatedOutputUsd: null,
    poolPair,
    reference,
  };
}

// Strictly positive and strictly above the threshold — a negative edge
// of any size is never an opportunity, whatever the threshold is set to.
export function clearsThreshold(spread: UnderlyingSpread, threshold: number): boolean {
  return spread.adjustedSpread > Math.max(0, threshold);
}

function toDetectionSnapshot(spread: UnderlyingSpread, threshold: number, reference: ReferenceQuote): DetectionSnapshot {
  return {
    ticker: spread.ticker,
    cheapPool: { address: spread.cheapPool.address, feeUnits: spread.cheapPool.feeUnits, priceUsd: spread.cheapPool.priceUsd },
    expensivePool: {
      address: spread.expensivePool.address,
      feeUnits: spread.expensivePool.feeUnits,
      priceUsd: spread.expensivePool.priceUsd,
    },
    grossGap: spread.rawSpread,
    netEdge: spread.adjustedSpread,
    threshold,
    gas: spread.gas,
    reference,
  };
}

export interface PreviewOpportunity {
  ticker: string;
  order: ProposedOrder;
  narration: string;
  verdict: GuardrailVerdict;
}

export interface PreviewOpportunitiesResult {
  spreads: UnderlyingSpread[];
  opportunities: PreviewOpportunity[];
  warmUp: Record<string, WarmUpStatus>;
}

export interface PreviewOpportunitiesDeps {
  spendTracker?: SpendTracker;
  guardrailConfig?: GuardrailConfig;
  agentConfig?: AgentLoopConfig;
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  estimateGasFn?: EstimateGasFn;
  fetchReferenceFn?: FetchReferenceFn;
  narrateProposalFn?: typeof realNarrateProposal;
  priceHistory?: PriceHistory;
}

// GET /api/opportunities needs narrated, verdict-bearing proposals for
// the Advisory Feed and Guardrail Gate panels, but a GET must stay
// side-effect-free. check() is pure, so this builds the same order
// runAgentLoop() would, runs it through check(), and narrates it, WITHOUT
// ever calling runPipeline(), writing the ledger, or recording prices.
// Same gates as the loop: no order below threshold or during warm-up.
export async function previewOpportunities(deps: PreviewOpportunitiesDeps = {}): Promise<PreviewOpportunitiesResult> {
  const spendTracker = deps.spendTracker ?? defaultSpendTracker;
  const guardrailConfig = deps.guardrailConfig ?? DEFAULT_GUARDRAIL_CONFIG;
  const agentConfig = deps.agentConfig ?? DEFAULT_AGENT_LOOP_CONFIG;
  const narrateProposalFn = deps.narrateProposalFn ?? realNarrateProposal;
  const history = deps.priceHistory ?? defaultPriceHistory;

  const spreads = await computeSpreads({
    underlyings: agentConfig.underlyings,
    fetchPoolQuotesFn: deps.fetchPoolQuotesFn,
    estimateGasFn: deps.estimateGasFn,
    gasSafetyMultiplier: agentConfig.gasSafetyMultiplier,
    fallbackGasCostUsd: agentConfig.fallbackGasCostUsd,
    slippagePctEstimate: agentConfig.slippagePctEstimate,
    tradeSizeUsd: agentConfig.orderSizeUsd,
  });

  const opportunities: PreviewOpportunity[] = [];
  const warmUp: Record<string, WarmUpStatus> = {};

  for (const spread of spreads) {
    const status = warmUpStatus(spread, history, guardrailConfig.minPriceHistoryReadings);
    warmUp[spread.ticker] = status;
    if (!clearsThreshold(spread, agentConfig.adjustedSpreadThreshold) || !status.complete) {
      continue;
    }

    // Only fetched when an order is actually built, so previews don't add
    // a Binance call per page poll.
    const reference = await (deps.fetchReferenceFn ?? defaultFetchReference)({
      ticker: spread.ticker,
      cheapPoolAddress: spread.cheapPool.address,
      sizeUsd: agentConfig.orderSizeUsd,
    });
    const order = constructOrder(spread, agentConfig, history, reference);
    const verdict = check(order, { spentTodaySoFarUsd: spendTracker.getSpentToday(), config: guardrailConfig });

    let narration: string;
    try {
      narration = narrateProposalFn(
        { ticker: order.ticker, adjustedSpread: spread.adjustedSpread, proposedSizeUsd: order.sizeUsd },
        verdict
      );
    } catch (err) {
      narration = `(narration unavailable: ${err instanceof Error ? err.message : "unknown error"})`;
    }

    opportunities.push({ ticker: spread.ticker, order, narration, verdict });
  }

  return { spreads, opportunities, warmUp };
}

export interface AgentLoopDeps {
  spendTracker?: SpendTracker;
  getMode?: () => PipelineMode;
  ledger?: AuditLedger;
  walletClient?: WalletClient;
  guardrailConfig?: GuardrailConfig;
  agentConfig?: AgentLoopConfig;
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  estimateGasFn?: EstimateGasFn;
  fetchReferenceFn?: FetchReferenceFn;
  narrateProposalFn?: typeof realNarrateProposal;
  priceHistory?: PriceHistory;
  // Forwarded straight through to runPipeline()'s PipelineDeps — lets
  // tests replace the pre-send freshness re-read/direct-swap-param
  // building without needing a live RPC endpoint.
  fetchFreshPoolPrices?: PipelineDeps["fetchFreshPoolPrices"];
  buildDirectSwapParams?: PipelineDeps["buildDirectSwapParams"];
  getWalletAddress?: PipelineDeps["getWalletAddress"];
}

// The full automatic loop: steps 1–6. narrateProposal needs a
// GuardrailVerdict, which only exists after runPipeline resolves, so this
// calls runPipeline before narrating. The order handed to runPipeline is
// fully built beforehand and never touched again, so a narrator failure
// (caught below, PRD rule 1) cannot change what the gate saw.
//
// Triggered by lib/orchestration/scheduler.ts, never by a GET route —
// this writes to the audit ledger and the price history.
//
// Every evaluated ticker writes exactly one ledger entry:
//   "no_opportunity" (detection) — the net edge doesn't clear;
//   "warming_up"     (detection) — it clears, but price history is short;
//   a pipeline entry             — an order was built and run.
// The ticker's pool prices are recorded into the history AFTER it is
// evaluated, so a price is never judged against itself.
export async function runAgentLoop(deps: AgentLoopDeps = {}): Promise<AgentLoopResult> {
  const spendTracker = deps.spendTracker ?? defaultSpendTracker;
  const getMode = deps.getMode ?? getKillswitchMode;
  const ledger = deps.ledger ?? defaultLedger;
  const guardrailConfig = deps.guardrailConfig ?? DEFAULT_GUARDRAIL_CONFIG;
  const agentConfig = deps.agentConfig ?? DEFAULT_AGENT_LOOP_CONFIG;
  const narrateProposalFn = deps.narrateProposalFn ?? realNarrateProposal;
  const history = deps.priceHistory ?? defaultPriceHistory;
  const mode = getMode();

  const spreads = await computeSpreads({
    underlyings: agentConfig.underlyings,
    fetchPoolQuotesFn: deps.fetchPoolQuotesFn,
    estimateGasFn: deps.estimateGasFn,
    gasSafetyMultiplier: agentConfig.gasSafetyMultiplier,
    fallbackGasCostUsd: agentConfig.fallbackGasCostUsd,
    slippagePctEstimate: agentConfig.slippagePctEstimate,
    tradeSizeUsd: agentConfig.orderSizeUsd,
  });

  const triggered: TriggeredOpportunity[] = [];
  const noOpportunities: NoOpportunityRecord[] = [];
  const warmingUp: WarmingUpRecord[] = [];

  const fetchReferenceFn = deps.fetchReferenceFn ?? defaultFetchReference;

  for (const spread of spreads) {
    try {
      // Every tick, not just when an order is built, so each detection
      // records the reference (or why it was unavailable) for the
      // dashboard. An order built this tick reuses it.
      const reference = await fetchReferenceFn({
        ticker: spread.ticker,
        cheapPoolAddress: spread.cheapPool.address,
        sizeUsd: agentConfig.orderSizeUsd,
      });
      const detection = toDetectionSnapshot(spread, agentConfig.adjustedSpreadThreshold, reference);

      if (!clearsThreshold(spread, agentConfig.adjustedSpreadThreshold)) {
        const entry = ledger.appendNoOpportunity({ mode, detection });
        noOpportunities.push({ ticker: spread.ticker, netEdge: spread.adjustedSpread, ledgerEntryId: entry.id });
        continue;
      }

      const status = warmUpStatus(spread, history, guardrailConfig.minPriceHistoryReadings);
      if (!status.complete) {
        const entry = ledger.appendWarmingUp({ mode, detection, warmUp: { readings: status.readings, required: status.required } });
        warmingUp.push({ ticker: spread.ticker, ledgerEntryId: entry.id, ...status });
        continue;
      }

      const order = constructOrder(spread, agentConfig, history, reference);

      const ledgerEntry = await runPipeline(
        order,
        {
          spentTodaySoFarUsd: spendTracker.getSpentToday(),
          config: guardrailConfig,
          walletClient: deps.walletClient,
          fetchFreshPoolPrices: deps.fetchFreshPoolPrices,
          buildDirectSwapParams: deps.buildDirectSwapParams,
          getWalletAddress: deps.getWalletAddress,
          gasCostUsdEstimate: spread.gas.costUsd,
          slippagePctEstimate: agentConfig.slippagePctEstimate,
          detection,
          ledger,
        },
        mode
      );

      if (ledgerEntry.outcome === "executed") {
        spendTracker.recordSpend(order.sizeUsd);
      }

      let narration: string;
      try {
        narration = narrateProposalFn(
          { ticker: order.ticker, adjustedSpread: spread.adjustedSpread, proposedSizeUsd: order.sizeUsd },
          ledgerEntry.verdict
        );
      } catch (err) {
        narration = `(narration unavailable: ${err instanceof Error ? err.message : "unknown error"})`;
      }

      triggered.push({
        ticker: spread.ticker,
        order,
        narration,
        verdict: ledgerEntry.verdict,
        outcome: ledgerEntry.outcome,
        ledgerEntryId: ledgerEntry.id,
      });
    } finally {
      history.record(spread.cheapPool.address, spread.cheapPool.priceUsd);
      history.record(spread.expensivePool.address, spread.expensivePool.priceUsd);
    }
  }

  return { timestamp: Date.now(), mode, spreads, triggered, noOpportunities, warmingUp };
}
