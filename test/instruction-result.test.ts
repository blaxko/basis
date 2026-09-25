import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeInstructionResult } from "../components/instruction-result";

// REAL replies from the deployed site, 2026-09-25 ~20:33 UTC (trimmed to
// the fields the box reads; values verbatim).
const REAL_200_NO_EDGE = {
  ok: true,
  ticker: "MSFT",
  outcome: "no_edge",
  order: { adjustedSpread: -0.008188710265587212, sizeUsd: 200 },
  verdict: { approved: true, status: "approved", reason: "all runnable guardrail checks passed; pending until simulation: dryRunFloor" },
};
const REAL_200_BLOCKED = {
  ok: true,
  ticker: "MSFT",
  outcome: "blocked",
  order: { adjustedSpread: -0.008091687059218252, sizeUsd: 1000 },
  verdict: { approved: false, status: "blocked", blockedBy: "perTradeCap", reason: "order size $1000 exceeds per-trade cap $500" },
};
const REAL_422_NVDA = {
  error: {
    kind: "pool_resolution_failed",
    ticker: "NVDA",
    message: "NotImplemented: no confirmed PancakeSwap V3 pool addresses for NVDA yet — see lib/data/pool-addresses.ts. Refusing to fabricate a pool address.",
  },
};

describe("describeInstructionResult — the three examples, from real replies", () => {
  it("$200: approved but not sent, net edge below zero", () => {
    expect(describeInstructionResult(200, REAL_200_NO_EDGE)).toEqual({
      tone: "approved",
      headline: "Approved by all guardrails, but not sent: net edge -0.82% is below zero.",
      detail: "After both pools' fees, slippage and gas, this trade would lose money, so Basis doesn't make it.",
    });
  });

  it("$1000: blocked by perTradeCap, with the server's reason", () => {
    expect(describeInstructionResult(200, REAL_200_BLOCKED)).toEqual({
      tone: "blocked",
      headline: "Blocked by perTradeCap: order size $1000 exceeds per-trade cap $500.",
      detail: "That's the per-trade limit. Nothing was sent.",
    });
  });

  it("NVDA: no pools known, Basis won't guess", () => {
    const r = describeInstructionResult(422, REAL_422_NVDA);
    expect(r.tone).toBe("info");
    expect(r.headline).toBe("No pools known for NVDA; Basis won't guess.");
  });
});

describe("describeInstructionResult — rate limit, warm-up and errors", () => {
  it("429 → wait a minute", () => {
    const r = describeInstructionResult(429, { error: "rate limited (ip); retry in 42s" });
    expect(r.headline).toBe("Too many requests, wait a minute and try again.");
    expect(r.detail).toContain("5 instructions a minute");
  });

  it("warming up → explains it's collecting price readings, with a wait estimate", () => {
    const r = describeInstructionResult(422, {
      error: { kind: "warming_up", ticker: "MSFT", readings: 3, required: 10, message: "price history has 3 of 10 readings — no orders until warm-up completes" },
    });
    expect(r.tone).toBe("info");
    expect(r.headline).toBe("Still warming up: 3 of 10 price readings collected.");
    expect(r.detail).toContain("one price reading every 30 seconds");
    expect(r.detail).toContain("about 4 minutes"); // 7 readings × 30 s = 3.5 min → 4
  });

  it("AI couldn't read it (schema_validation / invalid_json) → how to phrase it", () => {
    for (const kind of ["schema_validation", "invalid_json"]) {
      const r = describeInstructionResult(422, { error: { kind, message: "x", issues: [] } });
      expect(r.headline).toContain("couldn't turn that into an order");
      expect(r.detail).toContain("Buy $200 of MSFT");
    }
  });

  it("AI service down (llm_error) → nothing was evaluated", () => {
    expect(describeInstructionResult(422, { error: { kind: "llm_error", message: "Groq HTTP 503" } }).headline).toContain("nothing was evaluated");
  });

  it("400 → type something", () => {
    expect(describeInstructionResult(400, { error: "body must be { instruction: string }" }).headline).toContain("type an instruction");
  });

  it("network failure → couldn't reach the server", () => {
    expect(describeInstructionResult(null, { message: "Failed to fetch" })).toEqual({ tone: "error", headline: "Couldn't reach the server.", detail: "Failed to fetch" });
  });

  it("other approved outcomes are named, never shown as sent", () => {
    const approved = (outcome: string) =>
      describeInstructionResult(200, { ...REAL_200_NO_EDGE, outcome, order: { adjustedSpread: 0.004, sizeUsd: 200 } }).headline;
    expect(approved("simulated")).toBe("Approved by all guardrails. Simulation mode: checks only, nothing sent.");
    expect(approved("two_leg_execution_not_implemented")).toContain("live arbitrage is switched off");
    expect(approved("spread_closed")).toContain("the gap closed");
    expect(approved("dry_run_only")).toContain("Nothing sent in dry-run mode");
    expect(approved("tolerance_exceeds_edge")).toContain("too small to protect on-chain");
  });

  it("a guardrail internal error is shown as failing safe", () => {
    const r = describeInstructionResult(200, { ...REAL_200_BLOCKED, verdict: { approved: false, status: "error", reason: "guardrail internal error: x" } });
    expect(r.tone).toBe("blocked");
    expect(r.headline).toContain("failed safe");
  });
});

describe("dashboard wiring", () => {
  const root = join(__dirname, "..");
  it("the instruction box is on the page and says the AI only reads the instruction", () => {
    expect(readFileSync(join(root, "app", "page.tsx"), "utf8")).toContain("<InstructionBox />");
    const box = readFileSync(join(root, "components", "instruction-box.tsx"), "utf8");
    expect(box).toContain('fetch("/api/instruction"');
    expect(box).toContain("The AI only reads your sentence");
    for (const example of ["Buy $200 of MSFT", "Buy $1000 of MSFT", "Buy $100 of NVDA"]) expect(box).toContain(`"${example}"`);
    expect(box).toContain("Raw reply");
  });

  it("the Trading Capital / Operating Budget boxes are gone", () => {
    for (const f of ["components/header.tsx", "components/api-types.ts", "app/api/status/route.ts", "app/globals.css"]) {
      expect(readFileSync(join(root, f), "utf8")).not.toMatch(/Trading Capital|Operating Budget|tradingCapitalUsd|operatingBudgetUsd|wallet-split|wallet-card/);
    }
  });

  it('the feed is called "Advisory Feed" and says it is template-generated', () => {
    const feed = readFileSync(join(root, "components", "advisory-feed.tsx"), "utf8");
    expect(feed).toContain(">Advisory Feed<");
    expect(feed).not.toContain("LLM Advisory Feed");
    expect(feed).toContain("generated from fixed templates");
  });
});
