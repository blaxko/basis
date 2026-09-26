import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeInstructionResult } from "../components/instruction-result";
import { verdictBadge, notSentReason, ledgerVerdictWord } from "../components/verdict-wording";
import { narrateProposal } from "../lib/llm/proposal-narrator";
import type { GuardrailVerdict } from "../lib/guardrails/check";

// Live site, 2026-09-26: "Buy $200 of MSFT" showed a green "Approved by all
// guardrails …" headline and a green APPROVED badge next to "this trade
// would lose money". The checks passed, but nothing was (or should be)
// sent; the overall result must read as "not sent".

const ROOT = join(__dirname, "..");
const NO_EDGE_REPLY = {
  ok: true,
  ticker: "MSFT",
  outcome: "no_edge",
  order: { adjustedSpread: -0.008188710265587212, sizeUsd: 200 },
  verdict: { approved: true, status: "approved", reason: "all runnable guardrail checks passed; pending until simulation: dryRunFloor" },
};

const approvedVerdict = { approved: true, status: "approved", reason: "all runnable guardrail checks passed", checks: [] } as unknown as GuardrailVerdict;
const warming = [{ name: "sanityAndLiquidity", ok: false, warmingUp: true }] as GuardrailVerdict["checks"];

describe("instruction box: guardrails passed but nothing sent reads as 'not sent'", () => {
  it("no edge", () => {
    const r = describeInstructionResult(200, NO_EDGE_REPLY);
    expect(r.tone).toBe("not_sent");
    expect(r.headline).toBe("Guardrails passed · not sent: no positive edge (net edge -0.82%).");
    expect(r.headline).not.toMatch(/^Approved/);
  });

  it("every other not-sent outcome says 'not sent' and isn't the approved tone", () => {
    for (const outcome of ["simulated", "two_leg_execution_not_implemented", "spread_closed", "dry_run_only", "tolerance_exceeds_edge"]) {
      const r = describeInstructionResult(200, { ...NO_EDGE_REPLY, outcome, order: { adjustedSpread: 0.004, sizeUsd: 200 } });
      expect(r.tone).toBe("not_sent");
      expect(r.headline).toMatch(/^Guardrails passed · not sent/);
    }
  });

  it("only an executed trade uses the approved tone", () => {
    const r = describeInstructionResult(200, { ...NO_EDGE_REPLY, outcome: "executed" });
    expect(r).toMatchObject({ tone: "approved", headline: "Approved and sent." });
  });
});

describe("Guardrail Gate badge", () => {
  it("passed but not sent → 'GUARDRAILS PASSED · NOT SENT', neutral", () => {
    expect(verdictBadge(approvedVerdict, "no_edge")).toEqual({ label: "GUARDRAILS PASSED · NOT SENT", tone: "not-sent" });
    expect(verdictBadge(approvedVerdict, null)).toEqual({ label: "GUARDRAILS PASSED · NOT SENT", tone: "not-sent" });
  });
  it("executed → sent", () => {
    expect(verdictBadge(approvedVerdict, "executed")).toEqual({ label: "APPROVED · SENT", tone: "approved" });
  });
  it("blocked, error and warming up keep their meaning", () => {
    expect(verdictBadge({ ...approvedVerdict, approved: false, status: "blocked" }, "blocked").label).toBe("BLOCKED");
    expect(verdictBadge({ ...approvedVerdict, approved: false, status: "error" }, "error").label).toBe("ERROR");
    expect(verdictBadge({ ...approvedVerdict, approved: false, status: "blocked", checks: warming }, "blocked").label).toBe("WARMING UP");
  });
  it("says why it wasn't sent", () => {
    expect(notSentReason("no_edge", -0.0128)).toBe("no positive edge (net -1.28%)");
    expect(notSentReason("simulated", 0.001)).toBe("simulation mode: checks only");
    expect(notSentReason(null, 0.001)).toBe("preview only");
  });
  it("the panel uses verdictBadge, not a bare APPROVED", () => {
    const src = readFileSync(join(ROOT, "components/guardrail-checklist.tsx"), "utf8");
    expect(src).toContain("verdictBadge(");
    expect(src).not.toContain('return "APPROVED"');
  });
});

describe("Audit Ledger row", () => {
  it("passed-but-not-sent reads 'guardrails passed · not sent'", () => {
    expect(ledgerVerdictWord(approvedVerdict, "no_edge")).toBe("guardrails passed · not sent");
    expect(ledgerVerdictWord(approvedVerdict, "executed")).toBe("APPROVED · sent");
    expect(ledgerVerdictWord({ ...approvedVerdict, approved: false, status: "blocked" }, "blocked")).toBe("BLOCKED");
  });
  it("the panel uses ledgerVerdictWord", () => {
    expect(readFileSync(join(ROOT, "components/audit-ledger.tsx"), "utf8")).toContain("ledgerVerdictWord(");
  });
});

describe("narration (Advisory Feed, Raw reply)", () => {
  it("never says APPROVED; says the guardrails passed and, with no edge, that nothing is sent", () => {
    const text = narrateProposal({ ticker: "MSFT", adjustedSpread: -0.0128, proposedSizeUsd: 200 }, approvedVerdict);
    expect(text).not.toContain("APPROVED");
    expect(text).toContain("guardrails passed");
    expect(text).toContain("not sent");
  });
});
