import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dryRun, send } from "./agentic-wallet";

describe("dryRun without credentials configured", () => {
  const originalBaseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const originalApiKey = process.env.BINANCE_WEB3_API_KEY;

  beforeEach(() => {
    delete process.env.BINANCE_WEB3_API_BASE_URL;
    delete process.env.BINANCE_WEB3_API_KEY;
  });

  afterEach(() => {
    if (originalBaseUrl) process.env.BINANCE_WEB3_API_BASE_URL = originalBaseUrl;
    if (originalApiKey) process.env.BINANCE_WEB3_API_KEY = originalApiKey;
  });

  it("throws NotImplemented rather than returning a fabricated result", async () => {
    await expect(dryRun({ symbol: "NVDAon", side: "buy", sizeUsd: 200 })).rejects.toThrow(/NotImplemented/);
  });
});

describe("send without credentials configured", () => {
  const originalBaseUrl = process.env.AGENTIC_WALLET_API_BASE_URL;
  const originalApiKey = process.env.AGENTIC_WALLET_API_KEY;

  beforeEach(() => {
    delete process.env.AGENTIC_WALLET_API_BASE_URL;
    delete process.env.AGENTIC_WALLET_API_KEY;
  });

  afterEach(() => {
    if (originalBaseUrl) process.env.AGENTIC_WALLET_API_BASE_URL = originalBaseUrl;
    if (originalApiKey) process.env.AGENTIC_WALLET_API_KEY = originalApiKey;
  });

  it("throws NotImplemented rather than returning a fake transaction ID", async () => {
    await expect(send({ symbol: "NVDAon", side: "buy", sizeUsd: 200 })).rejects.toThrow(/NotImplemented/);
  });
});

describe("dryRun against the documented Transaction API shape (mocked)", () => {
  const originalBaseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const originalApiKey = process.env.BINANCE_WEB3_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BINANCE_WEB3_API_BASE_URL = "https://web3.example";
    process.env.BINANCE_WEB3_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.BINANCE_WEB3_API_BASE_URL = originalBaseUrl;
    process.env.BINANCE_WEB3_API_KEY = originalApiKey;
    global.fetch = originalFetch;
  });

  it("parses a well-formed dry-run response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ simulatedOutput: 199.5 }),
    }) as unknown as typeof fetch;

    const result = await dryRun({ symbol: "NVDAon", side: "buy", sizeUsd: 200 });
    expect(result.outputUsd).toBe(199.5);
  });

  it("throws on a malformed dry-run response instead of returning NaN", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ somethingElse: "oops" }),
    }) as unknown as typeof fetch;

    await expect(dryRun({ symbol: "NVDAon", side: "buy", sizeUsd: 200 })).rejects.toThrow(/malformed/);
  });

  it("throws when the upstream request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }) as unknown as typeof fetch;

    await expect(dryRun({ symbol: "NVDAon", side: "buy", sizeUsd: 200 })).rejects.toThrow(/failed/);
  });
});

describe("send against the documented Agentic Wallet shape (mocked)", () => {
  const originalBaseUrl = process.env.AGENTIC_WALLET_API_BASE_URL;
  const originalApiKey = process.env.AGENTIC_WALLET_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.AGENTIC_WALLET_API_BASE_URL = "https://wallet.example";
    process.env.AGENTIC_WALLET_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.AGENTIC_WALLET_API_BASE_URL = originalBaseUrl;
    process.env.AGENTIC_WALLET_API_KEY = originalApiKey;
    global.fetch = originalFetch;
  });

  it("parses a well-formed execute response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ txId: "0xabc123" }),
    }) as unknown as typeof fetch;

    const result = await send({ symbol: "NVDAon", side: "buy", sizeUsd: 200 });
    expect(result.txId).toBe("0xabc123");
  });

  it("throws on a malformed execute response instead of returning a fake txId", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(send({ symbol: "NVDAon", side: "buy", sizeUsd: 200 })).rejects.toThrow(/malformed/);
  });
});
