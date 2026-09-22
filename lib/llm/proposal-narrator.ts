import type { GuardrailVerdict } from "../guardrails/check";

// The Basis Model's structured opportunity, narrowed to what narration
// needs. Not the same shape as ProposedOrder or OrderIntent on purpose —
// this module only ever produces display text, so nothing here should
// look like something a caller could mistake for an executable order.
export interface BasisOpportunity {
  ticker: string;
  adjustedSpread: number;
  proposedSizeUsd: number;
}

const DRIFT_SUPPRESSION_EPSILON = 0.0005;

function describeLeg(adjustedSpread: number): string {
  if (Math.abs(adjustedSpread) < DRIFT_SUPPRESSION_EPSILON) {
    return "no meaningful spread after dividend-adjustment (structural drift correctly suppressed)";
  }
  return adjustedSpread > 0
    ? "price-return leg (xStocks/bStocks) cheap"
    : "total-return leg (Ondo) cheap";
}

function describeDecision(verdict: GuardrailVerdict, proposedSizeUsd: number): string {
  if (verdict.approved) {
    return `APPROVED (proposed size $${verdict.approvedSizeUsd ?? proposedSizeUsd})`;
  }
  return `BLOCKED (${verdict.reason})`;
}

// Produces the plain-English line for the LLM Advisory Feed. Text only:
// the return type is `string`, deliberately not overlapping with
// OrderIntent or ProposedOrder — there is no way to get an executable
// order back out of this function.
export function narrateProposal(opportunity: BasisOpportunity, verdict: GuardrailVerdict): string {
  const spreadPct = (opportunity.adjustedSpread * 100).toFixed(2);
  const legDescription = describeLeg(opportunity.adjustedSpread);
  const decision = describeDecision(verdict, opportunity.proposedSizeUsd);

  return `${opportunity.ticker}: ${spreadPct}% adjusted spread after dividend accrual, ${legDescription}, proposed size $${opportunity.proposedSizeUsd} — ${decision}.`;
}
