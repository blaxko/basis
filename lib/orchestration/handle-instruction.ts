import { fetchQuotes as realFetchQuotes } from "../data/quotes";
import { runPipeline, type WalletClient, type SwapRequest } from "../execution/pipeline";
import { AuditLedger, defaultLedger, type PipelineMode, type PipelineOutcome } from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import type { ProposedOrder, GuardrailVerdict } from "../guardrails/check";
import { parseIntent, type IntentParseError } from "../llm/intent-parser";
import { chatCompletion } from "../llm/groq-client";
import { narrateProposal as realNarrateProposal } from "../llm/proposal-narrator";
import { defaultSpendTracker, type SpendTracker } from "./spend-tracker";
import { getKillswitchMode } from "./killswitch";
import { computeSpreads } from "./agent-loop";

// The manual path. Free text -> intent-parser.ts -> (ONLY on a valid
// parse) the same runPipeline() the automatic loop uses — no second,
// parallel execution path. The critical invariant: intent-parser.ts
// returns ticker/side/sizeUsd only; every market-derived numeric field
// on the resulting ProposedOrder (price, liquidity, adjusted spread) is
// sourced here from lib/data + lib/basis-model, never trusted from the
// LLM's output, even though this module is now allowed to import both.

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
  | { ok: false; error: IntentParseError };

export interface HandleInstructionDeps {
  spendTracker?: SpendTracker;
  getMode?: () => PipelineMode;
  ledger?: AuditLedger;
  walletClient?: WalletClient;
  buildSwapRequest?: (order: ProposedOrder) => SwapRequest;
  guardrailConfig?: GuardrailConfig;
  fetchQuotesFn?: typeof realFetchQuotes;
  chatCompletionFn?: typeof chatCompletion;
  narrateProposalFn?: typeof realNarrateProposal;
  now?: () => number;
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
  const narrateProposalFn = deps.narrateProposalFn ?? realNarrateProposal;

  const [spread] = await computeSpreads({
    underlyings: [intent.ticker],
    fetchQuotesFn: deps.fetchQuotesFn,
    now: deps.now,
  });
  if (!spread) {
    throw new Error(`missing spread data for ${intent.ticker}`);
  }

  // Only ticker/side/sizeUsd come from the LLM's parsed intent; every
  // other field is sourced independently from live market data, never
  // from anything Groq returned.
  const order: ProposedOrder = {
    ticker: intent.ticker,
    side: intent.side,
    sizeUsd: intent.sizeUsd,
    adjustedSpread: spread.adjustedSpread,
    price: spread.priceReturnPrice,
    recentTicks: [],
    liquidityDepthUsd: spread.liquidityDepthUsd,
    simulatedOutputUsd: intent.sizeUsd,
  };

  const mode = getMode();
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
