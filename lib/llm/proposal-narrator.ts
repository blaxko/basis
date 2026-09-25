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

const NO_EDGE_EPSILON = 0.0005;

// adjustedSpread here is the net edge (after both pools' fees, slippage,
// and gas) — not a raw price diff. Positive means the gap genuinely
// survives real costs; this function doesn't know which pool is cheap,
// only whether the net number is worth anything, which is the caller's
// (agent-loop.ts's) job to have already decided before constructing
// this opportunity in the first place.
function describeEdge(adjustedSpread: number): string {
  if (Math.abs(adjustedSpread) < NO_EDGE_EPSILON) {
    return "no meaningful net edge after fees, slippage, and gas";
  }
  return adjustedSpread > 0
    ? "a real net edge survives costs"
    : "the raw gap does not survive costs";
}

function describeDecision(verdict: GuardrailVerdict, proposedSizeUsd: number): string {
  if (verdict.approved) {
    return `APPROVED (proposed size $${verdict.approvedSizeUsd ?? proposedSizeUsd})`;
  }
  return `BLOCKED (${verdict.reason})`;
}

// Produces the plain-English line for the Advisory Feed from a fixed
// template (no AI is involved). Text only:
// the return type is `string`, deliberately not overlapping with
// OrderIntent or ProposedOrder — there is no way to get an executable
// order back out of this function.
export function narrateProposal(opportunity: BasisOpportunity, verdict: GuardrailVerdict): string {
  const spreadPct = (opportunity.adjustedSpread * 100).toFixed(2);
  const edgeDescription = describeEdge(opportunity.adjustedSpread);
  const decision = describeDecision(verdict, opportunity.proposedSizeUsd);

  return `${opportunity.ticker}: ${spreadPct}% net spread after fees/slippage/gas, ${edgeDescription}, proposed size $${opportunity.proposedSizeUsd} — ${decision}.`;
}
