import { fetchPoolQuotes as realFetchPoolQuotes } from "../data/quotes";
import { runPipeline, type WalletClient, type PipelineDeps } from "../execution/pipeline";
import { AuditLedger, defaultLedger, type PipelineMode, type PipelineOutcome } from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import type { ProposedOrder, GuardrailVerdict, PoolPair } from "../guardrails/check";
import { parseIntent, type IntentParseError } from "../llm/intent-parser";
import { chatCompletion } from "../llm/groq-client";
import { narrateProposal as realNarrateProposal } from "../llm/proposal-narrator";
import { defaultSpendTracker, type SpendTracker } from "./spend-tracker";
import { getKillswitchMode } from "./killswitch";
import { computeSpreads, DEFAULT_AGENT_LOOP_CONFIG, type AgentLoopConfig } from "./agent-loop";

// The manual path. Free text -> intent-parser.ts -> pool-pair resolution
// -> (ONLY once both succeed) the same runPipeline() the automatic loop
// uses — no second, parallel execution path. The critical invariant:
// intent-parser.ts returns ticker/side/sizeUsd only; every market-derived
// numeric field on the resulting ProposedOrder (price, liquidity,
// adjusted spread, poolPair) is sourced here from lib/data +
// lib/basis-model + this module's own pool-pair resolution step, never
// trusted from the LLM's output, even though this module is now allowed
// to import both.

// A second, distinct failure mode from IntentParseError: the LLM's
// intent parsed fine (a real ticker/side/size), but no live cheap/expensive
// pool pair could be resolved for that ticker right now (e.g. fewer than
// two confirmed pools registered in lib/data/pool-addresses.ts, or an RPC
// failure reading them). Same posture as an intent-parser failure: return
// a typed rejection to the caller rather than constructing an incomplete
// order — there is no ProposedOrder without a poolPair, ever.
export interface PoolResolutionError {
  kind: "pool_resolution_failed";
  ticker: string;
  message: string;
}

export type InstructionResult =
  | {
      ok: true;
      ticker: string;
      order: ProposedOrder;
      narration: string;
      verdict: GuardrailVerdict;
      outcome: PipelineOutcome;
      ledgerEntryId: string;
    }
  | { ok: false; error: IntentParseError | PoolResolutionError };

export interface HandleInstructionDeps {
  spendTracker?: SpendTracker;
  getMode?: () => PipelineMode;
  ledger?: AuditLedger;
  walletClient?: WalletClient;
  guardrailConfig?: GuardrailConfig;
  agentConfig?: AgentLoopConfig;
  fetchPoolQuotesFn?: typeof realFetchPoolQuotes;
  chatCompletionFn?: typeof chatCompletion;
  narrateProposalFn?: typeof realNarrateProposal;
  // Forwarded straight through to runPipeline()'s PipelineDeps — same
  // reasoning as lib/orchestration/agent-loop.ts's AgentLoopDeps.
  fetchFreshPoolPrices?: PipelineDeps["fetchFreshPoolPrices"];
  buildDirectSwapParams?: PipelineDeps["buildDirectSwapParams"];
  getWalletAddress?: PipelineDeps["getWalletAddress"];
}

export async function handleInstruction(
  instruction: string,
  deps: HandleInstructionDeps = {}
): Promise<InstructionResult> {
  const parseResult = await parseIntent(instruction, { chatCompletion: deps.chatCompletionFn });

  // A parse failure never falls through to any default/guessed order —
  // this return is the only exit point before any order is built.
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }

  const intent = parseResult.intent;
  const spendTracker = deps.spendTracker ?? defaultSpendTracker;
  const getMode = deps.getMode ?? getKillswitchMode;
  const ledger = deps.ledger ?? defaultLedger;
  const guardrailConfig = deps.guardrailConfig ?? DEFAULT_GUARDRAIL_CONFIG;
  const agentConfig = deps.agentConfig ?? DEFAULT_AGENT_LOOP_CONFIG;
  const narrateProposalFn = deps.narrateProposalFn ?? realNarrateProposal;

  // Pool-pair resolution step: live-reads the ticker's cheapest and most
  // expensive known pool via the same computeSpreads() the automatic loop
  // uses. Any failure here (NotImplemented from an unregistered ticker in
  // lib/data/pool-addresses.ts, an RPC error, fewer than 2 pools) becomes
  // a typed rejection — never a partially-built order.
  let spread;
  try {
    const spreads = await computeSpreads({
      underlyings: [intent.ticker],
      fetchPoolQuotesFn: deps.fetchPoolQuotesFn,
      gasCostUsdEstimate: agentConfig.gasCostUsdEstimate,
      slippagePctEstimate: agentConfig.slippagePctEstimate,
      tradeSizeUsd: intent.sizeUsd,
    });
    spread = spreads[0];
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "pool_resolution_failed",
        ticker: intent.ticker,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (!spread) {
    return {
      ok: false,
      error: { kind: "pool_resolution_failed", ticker: intent.ticker, message: `no pool pair resolved for ${intent.ticker}` },
    };
  }

  const poolPair: PoolPair = {
    cheapPoolAddress: spread.cheapPool.address,
    cheapPoolFeeUnits: spread.cheapPool.feeUnits,
    expensivePoolAddress: spread.expensivePool.address,
    expensivePoolFeeUnits: spread.expensivePool.feeUnits,
  };

  // Only ticker/side/sizeUsd come from the LLM's parsed intent; every
  // other field is sourced independently from live market data (and this
  // resolution step), never from anything Groq returned.
  const order: ProposedOrder = {
    ticker: intent.ticker,
    side: intent.side,
    sizeUsd: intent.sizeUsd,
    adjustedSpread: spread.adjustedSpread,
    price: spread.cheapPool.priceUsd,
    recentTicks: [],
    liquidityDepthUsd: Math.min(spread.cheapPool.liquidityUsdEstimate, spread.expensivePool.liquidityUsdEstimate),
    // No live dry-run estimate exists before check() runs, so this is an
    // optimistic placeholder (100% of size). The real floor is enforced
    // authoritatively by pipeline.ts's own fresh simulateSwap() call afterward.
    simulatedOutputUsd: intent.sizeUsd,
    poolPair,
  };

  const mode = getMode();
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

  return {
    ok: true,
    ticker: intent.ticker,
    order,
    narration,
    verdict: ledgerEntry.verdict,
    outcome: ledgerEntry.outcome,
    ledgerEntryId: ledgerEntry.id,
  };
}
