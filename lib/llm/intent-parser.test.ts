import { describe, it, expect, vi } from "vitest";
import { parseIntent } from "./intent-parser";
import type { chatCompletion, GroqChatResult } from "./groq-client";

function mockChat(result: GroqChatResult): typeof chatCompletion {
  return vi.fn().mockResolvedValue(result) as unknown as typeof chatCompletion;
}

describe("parseIntent — valid input", () => {
  it("parses a well-formed Groq response into a correct structured order", async () => {
    const chat = mockChat({ ok: true, content: '{"ticker":"NVDA","side":"buy","sizeUsd":200}' });

    const result = await parseIntent("buy 200 dollars of nvda", { chatCompletion: chat });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent).toEqual({ ticker: "NVDA", side: "buy", sizeUsd: 200 });
    }
  });

  it("strips a markdown code fence if the model wraps its JSON in one", async () => {
    const chat = mockChat({ ok: true, content: '```json\n{"ticker":"MSFT","side":"sell","sizeUsd":150}\n```' });

    const result = await parseIntent("sell 150 of msft", { chatCompletion: chat });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent).toEqual({ ticker: "MSFT", side: "sell", sizeUsd: 150 });
    }
  });
});

describe("parseIntent — hallucinated or malformed responses are rejected", () => {
  it("rejects a ticker outside the confirmed 4-underlying list", async () => {
    const chat = mockChat({ ok: true, content: '{"ticker":"GOOG","side":"buy","sizeUsd":100}' });

    const result = await parseIntent("buy some google", { chatCompletion: chat });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema_validation");
    }
  });

  it("rejects a response missing a required field", async () => {
    const chat = mockChat({ ok: true, content: '{"ticker":"NVDA","side":"buy"}' });

    const result = await parseIntent("buy nvda", { chatCompletion: chat });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema_validation");
    }
  });

  it("rejects a response with a wrong-typed field instead of coercing it", async () => {
    const chat = mockChat({ ok: true, content: '{"ticker":"NVDA","side":"buy","sizeUsd":"two hundred"}' });

    const result = await parseIntent("buy nvda", { chatCompletion: chat });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema_validation");
    }
  });

  it("rejects a response that isn't valid JSON at all", async () => {
    const chat = mockChat({ ok: true, content: "sure, I'll buy some NVDA for you!" });

    const result = await parseIntent("buy nvda", { chatCompletion: chat });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_json");
    }
  });
});

describe("parseIntent — Groq-level failures propagate as typed errors", () => {
  it("returns a typed error when the underlying Groq call fails, without throwing", async () => {
    const chat = mockChat({ ok: false, error: { kind: "rate_limit", message: "429" } });

    const result = await parseIntent("buy nvda", { chatCompletion: chat });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("llm_error");
    }
  });
});
