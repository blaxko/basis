import { describe, it, expect, vi } from "vitest";
import { fetchAggregatorReference, type ReferenceDeps } from "./binance-reference";

const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" as const;

// REAL response from the first live call (docs/devex-log.md,
// 2026-09-24 21:32:02 UTC): 10 USDT -> MSFTB on BSC.
const REAL_BODY = {
  code: 0,
  msg: "success",
  data: [
    {
      quoteId: "58a214eac501420b9ea583de68bbeb07",
      vendorName: "LiquidMesh",
      executionMode: "SWAP",
      binanceChainId: "56",
      fromTokenAmount: "10000000000000000000",
      toTokenAmount: "20046272006646378",
      tradeFee: "0.0185302",
      estimateGasFee: "450000",
      priceImpactPercent: "0.0000000000",
      toToken: { tokenContractAddress: MSFTB, tokenSymbol: "MSFTB", tokenUnitPrice: "498.06357924776500237145000000", decimal: "18" },
      dexRouterList: [{ dexProtocol: { dexName: "Rfq Neptunex", percent: "100.00" } }],
      isBest: true,
    },
  ],
  timestamp: 1790285522228,
  success: true,
};

function deps(response: Partial<Response> | Error, config = { baseUrl: "https://web3.binance.com/build", apiKey: "k", secretKey: "s" }): ReferenceDeps & { fetchFn: ReturnType<typeof vi.fn> } {
  return {
    fetchFn: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response as Response;
    }),
    getConfigFn: () => config,
  };
}

const ok = (body: unknown): Partial<Response> => ({ ok: true, status: 200, json: async () => body });
const params = { stablecoin: USDT, targetToken: MSFTB, sizeUsd: 10, userWalletAddress: "0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7" };

describe("fetchAggregatorReference", () => {
  it("derives the quote-implied price from the real live response: 10 USDT / 0.020046 MSFTB = $498.85", async () => {
    const result = await fetchAggregatorReference(params, deps(ok(REAL_BODY)));
    expect(result).toEqual({ status: "ok", priceUsd: expect.closeTo(498.8459, 3), vendor: "LiquidMesh", route: "Rfq Neptunex" });
  });

  it("sends a signed GET to the documented endpoint with the sized amount and the wallet for RFQ routes", async () => {
    const d = deps(ok(REAL_BODY));
    await fetchAggregatorReference(params, d);

    const [url, init] = d.fetchFn.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/build/api/v1/dex/aggregator/quote");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      binanceChainId: "56",
      amount: "10000000000000000000",
      fromTokenAddress: USDT,
      toTokenAddress: MSFTB,
      userWalletAddress: params.userWalletAddress,
    });
    expect(Object.keys((init as RequestInit).headers as Record<string, string>).sort()).toEqual(["X-OC-APIKEY", "X-OC-SIGN", "X-OC-TIMESTAMP"]);
  });

  it("uses the best-marked route when several are returned", async () => {
    const body = {
      ...REAL_BODY,
      data: [
        { ...REAL_BODY.data[0], vendorName: "Pancake", toTokenAmount: "19000000000000000", isBest: false },
        { ...REAL_BODY.data[0], vendorName: "LiquidMesh", isBest: true },
      ],
    };
    const result = await fetchAggregatorReference(params, deps(ok(body)));
    expect(result.status === "ok" && result.vendor).toBe("LiquidMesh");
  });

  it.each([
    ["an HTTP error", { ok: false, status: 503, json: async () => ({}) } as Partial<Response>, "HTTP 503"],
    ["a non-zero API code", ok({ code: 40102, msg: "Signature error", data: null }), "code 40102: Signature error"],
    ["an empty route list", ok({ code: 0, msg: "success", data: [] }), "no routes returned"],
    ["a malformed route", ok({ code: 0, msg: "success", data: [{ toTokenAmount: "0", toToken: { decimal: "18" } }] }), "malformed route"],
  ])("returns unavailable, with the reason, for %s", async (_label, response, reason) => {
    const result = await fetchAggregatorReference(params, deps(response));
    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.reason).toContain(reason);
  });

  it("returns unavailable when the request itself fails (e.g. DNS)", async () => {
    const result = await fetchAggregatorReference(params, deps(new Error("getaddrinfo ENOTFOUND web3.binance.com")));
    expect(result).toEqual({ status: "unavailable", reason: "getaddrinfo ENOTFOUND web3.binance.com" });
  });

  it("returns unavailable without calling out when credentials aren't configured", async () => {
    const d: ReferenceDeps = { fetchFn: vi.fn(), getConfigFn: () => { throw new Error("NotImplemented"); } };
    const result = await fetchAggregatorReference(params, d);
    expect(result).toEqual({ status: "unavailable", reason: "Binance Web3 API credentials not configured" });
    expect(d.fetchFn).not.toHaveBeenCalled();
  });
});
