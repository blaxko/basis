import { fetchQuotes as realFetchQuotes, MVP_UNDERLYINGS } from "../data/quotes";
import { accruedDividend } from "../data/dividend-calendar";
import { navEquivalent } from "../basis-model/nav-equivalent";
import { rawSpread, adjustedSpread as computeAdjustedSpread } from "../basis-model/adjusted-spread";
import { runPipeline, type WalletClient, type SwapRequest } from "../execution/pipeline";
import { AuditLedger, defaultLedger, type PipelineMode, type PipelineOutcome } from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import { check, type ProposedOrder, type GuardrailVerdict } from "../guardrails/check";
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

export interface UnderlyingSpread {
  ticker: string;
  priceReturnPrice: number;
  totalReturnPrice: number;
  navEquivalentPrice: number;
  liquidityDepthUsd: number;
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
  adjustedSpreadThreshold: number;
  orderSizeUsd: number;
}

export const DEFAULT_AGENT_LOOP_CONFIG: AgentLoopConfig = {
  underlyings: MVP_UNDERLYINGS,
  adjustedSpreadThreshold: 0.003,
  orderSizeUsd: 200,
};

function utcDateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

// Steps 1–2: pull live quotes and compute the NAV-adjusted spread per
// underlying via the Basis Model. Deliberately side-effect-free — this
// is what GET /api/opportunities calls directly, since a GET must never
// trigger a guardrail/pipeline run.
export async function computeSpreads(deps: {
  underlyings?: readonly string[];
  fetchQuotesFn?: typeof realFetchQuotes;
  now?: () => number;
} = {}): Promise<UnderlyingSpread[]> {
  const underlyings = deps.underlyings ?? MVP_UNDERLYINGS;
  const fetchQuotesFn = deps.fetchQuotesFn ?? realFetchQuotes;
  const now = deps.now ?? Date.now;

  const quotes = await fetchQuotesFn([...underlyings]);
  const asOfDate = utcDateKey(now());

  return underlyings.map((ticker) => {
    const priceReturnQuote = quotes.find((q) => q.underlying === ticker && q.protocol === "xstocks");
    const totalReturnQuote = quotes.find((q) => q.underlying === ticker && q.protocol === "ondo");
    if (!priceReturnQuote || !totalReturnQuote) {
      throw new Error(`missing xstocks or ondo quote for ${ticker}`);
    }

    const accrued = accruedDividend(ticker, asOfDate);
    const navEquivalentPrice = navEquivalent(totalReturnQuote.price, accrued);
    const raw = rawSpread(totalReturnQuote.price, priceReturnQuote.price);
    const adjusted = computeAdjustedSpread(navEquivalentPrice, priceReturnQuote.price);

    return {
      ticker,
      priceReturnPrice: priceReturnQuote.price,
      totalReturnPrice: totalReturnQuote.price,
      navEquivalentPrice,
      liquidityDepthUsd: priceReturnQuote.liquidityDepth,
      rawSpread: raw,
      adjustedSpread: adjusted,
    };
  });
}

// Step 3: deterministic order construction — never the LLM's job for
// this automatic path. Side is derived purely from the sign of the
// adjusted spread: positive means the price-return leg is cheap
// relative to the NAV-equivalent, so we buy it; negative, we sell it.
function constructOrder(spread: UnderlyingSpread, config: AgentLoopConfig): ProposedOrder {
  return {
    ticker: spread.ticker,
    side: spread.adjustedSpread > 0 ? "buy" : "sell",
    sizeUsd: config.orderSizeUsd,
    adjustedSpread: spread.adjustedSpread,
    price: spread.priceReturnPrice,
    // No tick-history store exists yet — priceSanityCheck accepts any
    // positive price when history is empty (lib/basis-model/sanity-checks.ts),
    // so this is honest about what we actually know, not a fabricated history.
    recentTicks: [],
    liquidityDepthUsd: spread.liquidityDepthUsd,
    // No live dry-run estimate exists before check() runs, so this is an
    // optimistic placeholder (100% of size). The real floor is enforced
    // authoritatively by pipeline.ts's own fresh dryRun() call afterward.
    simulatedOutputUsd: config.orderSizeUsd,
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
  fetchQuotesFn?: typeof realFetchQuotes;
  narrateProposalFn?: typeof realNarrateProposal;
  now?: () => number;
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
    fetchQuotesFn: deps.fetchQuotesFn,
    now: deps.now,
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
  buildSwapRequest?: (order: ProposedOrder) => SwapRequest;
  guardrailConfig?: GuardrailConfig;
  agentConfig?: AgentLoopConfig;
  fetchQuotesFn?: typeof realFetchQuotes;
  narrateProposalFn?: typeof realNarrateProposal;
  now?: () => number;
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
    fetchQuotesFn: deps.fetchQuotesFn,
    now: deps.now,
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
        buildSwapRequest: deps.buildSwapRequest,
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
