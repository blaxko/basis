import { describe, it, expect, vi } from "vitest";
import { handleInstruction } from "../lib/orchestration/handle-instruction";
import { parseIntent } from "../lib/llm/intent-parser";
import { AuditLedger } from "../lib/execution/audit-ledger";
import { DailySpendTracker } from "../lib/orchestration/spend-tracker";
import type { chatCompletion } from "../lib/llm/groq-client";
import { describeInstructionResult } from "../components/instruction-result";

// Live site, 2026-09-26: "sell $50 of MSFT" came back green "Approved by
// all guardrails" (Basis only builds the buy leg); "buy $0 of MSFT",
// "buy some microsoft" and "purple monkey dishwasher" all got the same
// "The AI couldn't turn that into an order", which blames the AI and
// doesn't say what was missing.

const groqSays = (content: string) => vi.fn().mockResolvedValue({ ok: true, content }) as unknown as typeof chatCompletion;

describe("sell orders are refused plainly, never approved", () => {
  it("handleInstruction refuses side=sell before reading any pool, and writes nothing", async () => {
    const fetchPoolQuotesFn = vi.fn();
    const ledger = new AuditLedger();
    const result = await handleInstruction("sell $50 of MSFT", {
      chatCompletionFn: groqSays('{"ticker":"MSFT","side":"sell","sizeUsd":50}'),
      fetchPoolQuotesFn,
      ledger,
      spendTracker: new DailySpendTracker(),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("unsupported_side");
    expect(fetchPoolQuotesFn).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });

  it("the box says sells aren't supported, not approved", () => {
    const r = describeInstructionResult(422, { error: { kind: "unsupported_side", ticker: "MSFT", side: "sell", message: "x" } });
    expect(r.headline).toBe("Basis only buys the cheaper pool leg for now; sells aren't supported.");
    expect(r.tone).not.toBe("approved");
    expect(r.headline + (r.detail ?? "")).not.toMatch(/approved/i);
  });
});

describe("the parser says which part of the order is missing or wrong", () => {
  it.each([
    ["$0", '{"ticker":"MSFT","side":"buy","sizeUsd":0}', "amount"],
    ["no amount (null)", '{"ticker":"MSFT","side":"buy","sizeUsd":null}', "amount"],
    ["negative amount", '{"ticker":"MSFT","side":"buy","sizeUsd":-5}', "amount"],
    ["a stock Basis doesn't list", '{"ticker":"GOOGL","side":"buy","sizeUsd":100}', "ticker"],
    ["no side", '{"ticker":"MSFT","side":null,"sizeUsd":100}', "side"],
    ["nonsense", '{"ticker":null,"side":null,"sizeUsd":null}', "not_an_order"],
  ])("%s → problem %s", async (_label, content, problem) => {
    const r = await parseIntent("x", { chatCompletion: groqSays(content) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe("schema_validation");
    expect(!r.ok && r.error.kind === "schema_validation" && r.error.problem).toBe(problem);
  });

  it("a non-JSON answer is treated as not an order", async () => {
    const r = await parseIntent("x", { chatCompletion: groqSays("I can't help with that.") });
    expect(!r.ok && r.error.kind === "invalid_json" && r.error.problem).toBe("not_an_order");
  });

  it("the prompt asks for null instead of a guessed amount, and accepts any language", async () => {
    const chat = groqSays('{"ticker":"MSFT","side":"buy","sizeUsd":100}');
    await parseIntent("Achète 100 dollars d'actions Microsoft", { chatCompletion: chat });
    const messages = (chat as unknown as { mock: { calls: Array<[Array<{ content: string }>]> } }).mock.calls[0]![0];
    const system = messages[0]!.content;
    expect(system).toMatch(/null/);
    expect(system).toMatch(/any language/i);
  });
});

describe("the box gives one plain sentence per problem", () => {
  const box = (problem: string, kind = "schema_validation") => describeInstructionResult(422, { error: { kind, problem, message: "x", issues: [] } });

  it("$0 or no amount", () => {
    expect(box("amount").headline).toBe("Basis needs a dollar amount above $0, for example: Buy $200 of MSFT.");
  });
  it("a stock Basis doesn't cover", () => {
    expect(box("ticker").headline).toBe("Basis only covers Microsoft (MSFT) today.");
  });
  it("no buy/sell", () => {
    expect(box("side").headline).toBe("Say that you want to buy, for example: Buy $200 of MSFT.");
  });
  it("nonsense or unreadable text", () => {
    for (const kind of ["schema_validation", "invalid_json"]) {
      const r = box("not_an_order", kind);
      expect(r.headline).toBe("That doesn't look like an order. Try: Buy $200 of MSFT.");
      expect(r.detail).toMatch(/other languages/i);
    }
  });
  it("none of these blame the AI", () => {
    for (const p of ["amount", "ticker", "side", "not_an_order"]) expect(box(p).headline).not.toMatch(/\bAI\b/);
  });
});
