import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chatCompletion } from "./groq-client";

describe("chatCompletion without a Groq API key configured", () => {
  const originalKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.GROQ_API_KEY = originalKey;
  });

  it("returns a typed not_implemented error instead of throwing", async () => {
    const result = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_implemented");
    }
  });
});

describe("chatCompletion against the documented Groq shape (mocked)", () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.GROQ_API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  it("returns the message content on a well-formed success response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"ticker":"NVDA"}' } }] }),
    }) as unknown as typeof fetch;

    const result = await chatCompletion([{ role: "user", content: "buy nvda" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('{"ticker":"NVDA"}');
    }
  });

  it("never sends the API key anywhere but the Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await chatCompletion([{ role: "user", content: "hi" }]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(JSON.stringify(init.body)).not.toContain("test-key");
  });

  it("returns a typed rate_limit error on HTTP 429, without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }) as unknown as typeof fetch;

    const result = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("rate_limit");
    }
  });

  it("returns a typed timeout error when the request is aborted, without throwing", async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const result = await chatCompletion([{ role: "user", content: "hi" }], { timeoutMs: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("returns a typed error on a generic HTTP failure without echoing response body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }) as unknown as typeof fetch;

    const result = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("http_error");
    }
  });

  it("returns a typed error on a malformed success response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nothing: "useful" }),
    }) as unknown as typeof fetch;

    const result = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformed_response");
    }
  });
});
