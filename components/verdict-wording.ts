// How a guardrail verdict reads on the dashboard. The checks passing is
// not the same as a trade happening: unless the outcome is "executed",
// the overall result reads "not sent", in a neutral colour — never a
// green APPROVED beside a trade that would lose money. Individual checks
// keep their green [PASS]. Pure; tested in test/not-sent-wording.test.ts.

export type BadgeTone = "approved" | "not-sent" | "blocked" | "warming" | "error";

interface VerdictLike {
  approved: boolean;
  status: string;
  checks: Array<{ warmingUp?: boolean }>;
}

// `outcome` is the pipeline outcome from the ledger, or null for a live
// preview that hasn't been run.
export function verdictBadge(verdict: VerdictLike, outcome: string | null): { label: string; tone: BadgeTone } {
  if (verdict.approved) {
    return outcome === "executed" ? { label: "APPROVED · SENT", tone: "approved" } : { label: "GUARDRAILS PASSED · NOT SENT", tone: "not-sent" };
  }
  if (verdict.status === "error") return { label: "ERROR", tone: "error" };
  return verdict.checks.some((c) => c.warmingUp) ? { label: "WARMING UP", tone: "warming" } : { label: "BLOCKED", tone: "blocked" };
}

function pct(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

// Why an approved order wasn't sent, in a few words.
export function notSentReason(outcome: string | null, netEdge: number): string {
  switch (outcome) {
    case null:
      return "preview only";
    case "no_edge":
      return `no positive edge (net ${pct(netEdge)})`;
    case "simulated":
      return "simulation mode: checks only";
    case "dry_run_only":
      return "dry-run: rehearsed, not sent";
    case "two_leg_execution_not_implemented":
      return "live arbitrage is switched off";
    case "spread_closed":
      return "the gap closed on re-read";
    case "tolerance_exceeds_edge":
      return `edge too small to protect on-chain (net ${pct(netEdge)})`;
    default:
      return outcome;
  }
}

// The verdict word on an Audit Ledger pipeline row.
export function ledgerVerdictWord(verdict: VerdictLike, outcome: string): string {
  if (verdict.approved) return outcome === "executed" ? "APPROVED · sent" : "guardrails passed · not sent";
  return verdict.status === "error" ? "ERROR" : "BLOCKED";
}
