import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fetchQuote, tokenSymbol } from "./quotes";

describe("tokenSymbol", () => {
  it("applies the Ondo 'on' suffix", () => {
    expect(tokenSymbol("ondo", "NVDA")).toBe("NVDAon");
  });

  it("applies protocol-specific suffixes for xStocks/bStocks", () => {
    expect(tokenSymbol("xstocks", "AAPL")).toBe("AAPLx");
    expect(tokenSymbol("bstocks", "TSLA")).toBe("TSLAb");
  });
});

describe("fetchQuote without credentials configured", () => {
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

  it("throws rather than returning a fabricated quote", async () => {
    await expect(fetchQuote("xstocks", "NVDA")).rejects.toThrow(/NotImplemented/);
  });
});
