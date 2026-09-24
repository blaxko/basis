import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchQuote, fetchPoolQuotes, tokenSymbol, buildAuthHeaders } from "./quotes";
import * as pancakeswapV3 from "./pancakeswap-v3";

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
  const originalSecret = process.env.BINANCE_WEB3_API_SECRET;

  beforeEach(() => {
    delete process.env.BINANCE_WEB3_API_BASE_URL;
    delete process.env.BINANCE_WEB3_API_KEY;
    delete process.env.BINANCE_WEB3_API_SECRET;
  });

  afterEach(() => {
    if (originalBaseUrl) process.env.BINANCE_WEB3_API_BASE_URL = originalBaseUrl;
    if (originalApiKey) process.env.BINANCE_WEB3_API_KEY = originalApiKey;
    if (originalSecret) process.env.BINANCE_WEB3_API_SECRET = originalSecret;
  });

  it("throws rather than returning a fabricated quote", async () => {
    await expect(fetchQuote("xstocks", "NVDA")).rejects.toThrow(/NotImplemented/);
  });
});

describe("buildAuthHeaders — real HMAC-SHA256 scheme, confirmed against web3.binance.com/en/dev-docs/authentication", () => {
  it("computes X-OC-SIGN as base64(HMAC-SHA256(timestamp + method + requestPath + body, secretKey))", () => {
    const timestamp = "2026-09-23T12:00:00.000Z";
    const url = "https://web3.binance.com/build/quote?symbol=NVDAx";

    const headers = buildAuthHeaders("test-key", "test-secret", "GET", url, "", timestamp);

    const expectedPreHash = `${timestamp}GET/build/quote?symbol=NVDAx`;
    const expectedSignature = createHmac("sha256", "test-secret").update(expectedPreHash).digest("base64");

    expect(headers).toEqual({
      "X-OC-APIKEY": "test-key",
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": expectedSignature,
    });
  });

  it("includes the request body in the signed preHash for POST requests", () => {
    const timestamp = "2026-09-23T12:00:00.000Z";
    const url = "https://web3.binance.com/build/transaction/dry-run";
    const body = JSON.stringify({ symbol: "NVDAx", side: "buy", sizeUsd: 200 });

    const headers = buildAuthHeaders("test-key", "test-secret", "POST", url, body, timestamp);

    const expectedPreHash = `${timestamp}POST/build/transaction/dry-run${body}`;
    const expectedSignature = createHmac("sha256", "test-secret").update(expectedPreHash).digest("base64");

    expect(headers["X-OC-SIGN"]).toBe(expectedSignature);
  });

  it("produces a different signature for a different secret key, proving the secret is actually used", () => {
    const timestamp = "2026-09-23T12:00:00.000Z";
    const url = "https://web3.binance.com/build/quote?symbol=NVDAx";

    const headersA = buildAuthHeaders("test-key", "secret-a", "GET", url, "", timestamp);
    const headersB = buildAuthHeaders("test-key", "secret-b", "GET", url, "", timestamp);

    expect(headersA["X-OC-SIGN"]).not.toBe(headersB["X-OC-SIGN"]);
  });
});

describe("fetchPoolQuotes — reads all known pools for a ticker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one PoolQuote per registered pool, for MSFT's two real pools", async () => {
    vi.spyOn(pancakeswapV3, "readPoolPrice").mockImplementation(async (poolAddress, _stablecoin, feeUnits) => ({
      poolAddress: poolAddress as string,
      feeUnits,
      priceUsd: feeUnits === 2500 ? 500.54 : 496.98,
      liquidityUsdEstimate: 100_000,
      token0: "0x55d398326f99059fF775485246999027B3197955",
      token1: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0",
    }));

    const quotes = await fetchPoolQuotes("MSFT");

    expect(quotes).toHaveLength(2);
    expect(quotes.every((q) => q.ticker === "MSFT")).toBe(true);
    const feeTiers = quotes.map((q) => q.feeUnits).sort((a, b) => a - b);
    expect(feeTiers).toEqual([2500, 10000]);
    const cheap = quotes.find((q) => q.feeUnits === 10000)!;
    const expensive = quotes.find((q) => q.feeUnits === 2500)!;
    expect(expensive.priceUsd).toBeGreaterThan(cheap.priceUsd);
  });

  it("throws NotImplemented for a ticker with no registered pools, never fabricating a quote", async () => {
    await expect(fetchPoolQuotes("AAPL")).rejects.toThrow(/NotImplemented/);
  });
});
