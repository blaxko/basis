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
// The agent loop builds an order only above this net edge
// (adjustedSpreadThreshold, 0.01%), so a positive edge between it and
// NO_EDGE_EPSILON is a built order whose edge is small, not "no edge".
const ORDER_THRESHOLD = 0.0001;

// adjustedSpread here is the net edge (after both pools' fees, slippage,
// and gas) — not a raw price diff. Positive means the gap genuinely
// survives real costs; this function doesn't know which pool is cheap,
// only whether the net number is worth anything, which is the caller's
// (agent-loop.ts's) job to have already decided before constructing
// this opportunity in the first place.
function describeEdge(adjustedSpread: number): string {
  if (adjustedSpread > ORDER_THRESHOLD && adjustedSpread < NO_EDGE_EPSILON) {
    return "a small positive net edge remains after costs, too small to protect on-chain";
  }
  if (Math.abs(adjustedSpread) < NO_EDGE_EPSILON) {
    return "no meaningful net edge after fees, slippage, and gas";
  }
  return adjustedSpread > 0
    ? "a real net edge survives costs"
    : "the raw gap does not survive costs";
}

// "guardrails passed", never "APPROVED": passing the checks is not a
// trade. With no positive edge the line says outright that nothing is sent.
function describeDecision(verdict: GuardrailVerdict, proposedSizeUsd: number, adjustedSpread: number): string {
  if (verdict.approved) {
    const size = `size $${verdict.approvedSizeUsd ?? proposedSizeUsd}`;
    return adjustedSpread > 0
      ? `guardrails passed (${size}), but nothing is sent: this demo never sends a trade`
      : `guardrails passed (${size}), not sent: no positive edge`;
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
  const decision = describeDecision(verdict, opportunity.proposedSizeUsd, opportunity.adjustedSpread);

  return `${opportunity.ticker}: ${spreadPct}% net spread after fees/slippage/gas, ${edgeDescription}, proposed size $${opportunity.proposedSizeUsd} — ${decision}.`;
}
