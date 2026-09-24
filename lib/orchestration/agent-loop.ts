import { fetchPoolQuotes as realFetchPoolQuotes, MVP_UNDERLYINGS } from "../data/quotes";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { rawSpread, adjustedSpread as computeAdjustedSpread } from "../basis-model/adjusted-spread";
import { runPipeline, type WalletClient, type PipelineDeps } from "../execution/pipeline";
import { AuditLedger, defaultLedger, type PipelineMode, type PipelineOutcome } from "../execution/audit-ledger";
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
// between them — the AMM cross-pool detection unit, replacing the old
// xStocks-vs-Ondo pair. rawSpread is diagnostic-only (never an execution
// signal); adjustedSpread is the net edge after both pools' fees,
// estimated slippage, and gas.
export interface UnderlyingSpread {
  ticker: string;
  cheapPool: PoolLeg;
  expensivePool: PoolLeg;
  rawSpread: number;
  adjustedSpread: number;
}

export interface TriggeredOpportunity {
  ticker: string;
  order: ProposedOrder;
  narration: string;
  verdict: GuardrailVerdict;
  outcome: PipelineOutcome;
  ledgerEntryId: string;
}

export interface AgentLoopResult {
  timestamp: number;
  mode: PipelineMode;
  spreads: UnderlyingSpread[];
  triggered: TriggeredOpportunity[];
}

export interface AgentLoopConfig {
  underlyings: readonly string[];
  // Old mechanism used 0.3% to filter dividend-accrual noise out of a
  // RAW diff. adjustedSpread is now already net of fees+slippage+gas —
  // real edges found this session were near-zero even in the closest
  // case (+0.0099% before slippage/gas, net negative after), so
  // carrying over 0.3% would mean the system could never trigger on any
  // real edge found so far. Lowered to a small epsilon that filters
  // floating-point dust, not genuine (if tiny) positive edges.
  adjustedSpreadThreshold: number;
  orderSizeUsd: number;
  // Same assumptions used throughout this session's basis-model tests
  // (~200k gas units, ~1.5 gwei, BNB ~$700) — a rough order-of-magnitude
  // estimate, not a live gas quote. Configurable so a real gas oracle
  // can replace this later without changing the math's shape.
  gasCostUsdEstimate: number;
  slippagePctEstimate: number;
}

export const DEFAULT_AGENT_LOOP_CONFIG: AgentLoopConfig = {
  underlyings: MVP_UNDERLYINGS,
  adjustedSpreadThreshold: 0.0001,
  orderSizeUsd: 200,
  gasCostUsdEstimate: 200_000 * 1.5e-9 * 700,
  slippagePctEstimate: 0.0005,
};

// Steps 1–2: pull live per-pool prices and compute the net cross-pool
// edge per underlying via the Basis Model. Deliberately side-effect-free
// — this is what GET /api/opportunities calls directly, since a GET must
// never trigger a guardrail/pipeline run.
export async function computeSpreads(deps: {
  underlyings?: readonly string[];
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  gasCostUsdEstimate?: number;
  slippagePctEstimate?: number;
  tradeSizeUsd?: number;
} = {}): Promise<UnderlyingSpread[]> {
  const underlyings = deps.underlyings ?? MVP_UNDERLYINGS;
  const fetchPoolQuotesFn = deps.fetchPoolQuotesFn ?? realFetchPoolQuotes;
  const gasCostUsdEstimate = deps.gasCostUsdEstimate ?? DEFAULT_AGENT_LOOP_CONFIG.gasCostUsdEstimate;
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

      const raw = rawSpread(cheapPool.priceUsd, expensivePool.priceUsd);
      const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPool.priceUsd, cheapPool.feeUnits, "buy");
      const effectiveSellPriceUsd = feeAdjustedPrice(expensivePool.priceUsd, expensivePool.feeUnits, "sell");
      const adjusted = computeAdjustedSpread({
        effectiveBuyPriceUsd,
        effectiveSellPriceUsd,
        slippagePct: slippagePctEstimate,
        gasCostUsd: gasCostUsdEstimate,
        tradeSizeUsd,
      });

      return { ticker, cheapPool, expensivePool, rawSpread: raw, adjustedSpread: adjusted };
    })
  );
}

// Step 3: deterministic order construction — never the LLM's job for
// this automatic path. The order represents buying on the cheap pool;
// poolPair carries both legs' identity so downstream (the freshness
// re-check, buildDirectSwapParams()) knows exactly which two pools this
// order refers to. KNOWN SIMPLIFICATION: this models the trade as a
// single "buy the cheap pool" leg — a true two-leg atomic arbitrage
// (also selling the expensive pool to realize the edge) is not built
// yet; poolPair exists so that work has something to build on, not
// because this session claims to have solved it.
function constructOrder(spread: UnderlyingSpread, config: AgentLoopConfig): ProposedOrder {
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
    // No tick-history store exists yet — priceSanityCheck accepts any
    // positive price when history is empty (lib/basis-model/sanity-checks.ts),
    // so this is honest about what we actually know, not a fabricated history.
    recentTicks: [],
    liquidityDepthUsd: Math.min(spread.cheapPool.liquidityUsdEstimate, spread.expensivePool.liquidityUsdEstimate),
    // No live dry-run estimate exists before check() runs, so this is an
    // optimistic placeholder (100% of size). The real floor is enforced
    // authoritatively by pipeline.ts's own fresh dryRun() call afterward.
    simulatedOutputUsd: config.orderSizeUsd,
    poolPair,
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
}

export interface PreviewOpportunitiesDeps {
  spendTracker?: SpendTracker;
  guardrailConfig?: GuardrailConfig;
  agentConfig?: AgentLoopConfig;
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  narrateProposalFn?: typeof realNarrateProposal;
}

// Phase 5a addition (originally this file only had computeSpreads() and
// runAgentLoop()): GET /api/opportunities needs narrated, verdict-bearing
// proposals for the Advisory Feed and Guardrail Gate panels, but a GET
// must stay side-effect-free. check() (Phase 2) is pure — no wallet call,
// no ledger write — so this builds the same deterministic order
// runAgentLoop() would, runs it through check() for a live-accurate
// verdict, and narrates it, WITHOUT ever calling runPipeline(). Nothing
// here writes to the ledger or touches agentic-wallet.
export async function previewOpportunities(deps: PreviewOpportunitiesDeps = {}): Promise<PreviewOpportunitiesResult> {
  const spendTracker = deps.spendTracker ?? defaultSpendTracker;
  const guardrailConfig = deps.guardrailConfig ?? DEFAULT_GUARDRAIL_CONFIG;
  const agentConfig = deps.agentConfig ?? DEFAULT_AGENT_LOOP_CONFIG;
  const narrateProposalFn = deps.narrateProposalFn ?? realNarrateProposal;

  const spreads = await computeSpreads({
    underlyings: agentConfig.underlyings,
    fetchPoolQuotesFn: deps.fetchPoolQuotesFn,
    gasCostUsdEstimate: agentConfig.gasCostUsdEstimate,
    slippagePctEstimate: agentConfig.slippagePctEstimate,
    tradeSizeUsd: agentConfig.orderSizeUsd,
  });

  const opportunities: PreviewOpportunity[] = [];

  for (const spread of spreads) {
    if (Math.abs(spread.adjustedSpread) < agentConfig.adjustedSpreadThreshold) {
      continue;
    }

    const order = constructOrder(spread, agentConfig);
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

  return { spreads, opportunities };
}

export interface AgentLoopDeps {
  spendTracker?: SpendTracker;
  getMode?: () => PipelineMode;
  ledger?: AuditLedger;
  walletClient?: WalletClient;
  guardrailConfig?: GuardrailConfig;
  agentConfig?: AgentLoopConfig;
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  narrateProposalFn?: typeof realNarrateProposal;
  // Forwarded straight through to runPipeline()'s PipelineDeps — lets
  // tests (and, later, a real gas oracle) replace the pre-send freshness
  // re-read/direct-swap-param building without needing a live RPC
  // endpoint just to exercise this loop's own composition.
  fetchFreshPoolPrices?: PipelineDeps["fetchFreshPoolPrices"];
  buildDirectSwapParams?: PipelineDeps["buildDirectSwapParams"];
  getWalletAddress?: PipelineDeps["getWalletAddress"];
}

// The full automatic loop: steps 1–6. Note the call order deviates
// slightly from the PRD's own step numbering — narrateProposal's Phase 4
// signature requires a GuardrailVerdict, which only exists after
// runPipeline resolves, so this calls runPipeline before narrating.
// The order handed to runPipeline is fully built beforehand and never
// touched again, so a narrator failure (caught below, PRD rule 1) cannot
// retroactively change what was already sent to the guardrail gate.
//
// Not wired to any API route in this phase — GET routes must stay
// side-effect-free, and this function writes to the audit ledger and
// can execute real trades in live mode. Triggering it is a later
// integration point.
//
// A correctly DECLINED trade (edge doesn't clear net, or the freshness
// check fails closed) is exactly as valid and complete an outcome here
// as an executed one — both write a full ledger entry, both narrate,
// neither is a lesser code path.
export async function runAgentLoop(deps: AgentLoopDeps = {}): Promise<AgentLoopResult> {
  const spendTracker = deps.spendTracker ?? defaultSpendTracker;
  const getMode = deps.getMode ?? getKillswitchMode;
  const ledger = deps.ledger ?? defaultLedger;
  const guardrailConfig = deps.guardrailConfig ?? DEFAULT_GUARDRAIL_CONFIG;
  const agentConfig = deps.agentConfig ?? DEFAULT_AGENT_LOOP_CONFIG;
  const narrateProposalFn = deps.narrateProposalFn ?? realNarrateProposal;
  const mode = getMode();

  const spreads = await computeSpreads({
    underlyings: agentConfig.underlyings,
    fetchPoolQuotesFn: deps.fetchPoolQuotesFn,
    gasCostUsdEstimate: agentConfig.gasCostUsdEstimate,
    slippagePctEstimate: agentConfig.slippagePctEstimate,
    tradeSizeUsd: agentConfig.orderSizeUsd,
  });

  const triggered: TriggeredOpportunity[] = [];

  for (const spread of spreads) {
    if (Math.abs(spread.adjustedSpread) < agentConfig.adjustedSpreadThreshold) {
      continue;
    }

    const order = constructOrder(spread, agentConfig);

    const ledgerEntry = await runPipeline(
      order,
      {
        spentTodaySoFarUsd: spendTracker.getSpentToday(),
        config: guardrailConfig,
        walletClient: deps.walletClient,
        fetchFreshPoolPrices: deps.fetchFreshPoolPrices,
        buildDirectSwapParams: deps.buildDirectSwapParams,
        getWalletAddress: deps.getWalletAddress,
        gasCostUsdEstimate: agentConfig.gasCostUsdEstimate,
        slippagePctEstimate: agentConfig.slippagePctEstimate,
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
  }

  return { timestamp: Date.now(), mode, spreads, triggered };
}
