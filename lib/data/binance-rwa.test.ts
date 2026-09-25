import { describe, it, expect, vi } from "vitest";
import { fetchMarketStatus, recordLatestMarketStatus, getLatestMarketStatuses } from "./binance-rwa";
import { BinanceCallLog, type BinanceClientDeps } from "./binance-client";

function deps(response: { status: number; text: string } | Error): BinanceClientDeps & { fetchFn: ReturnType<typeof vi.fn> } {
  return {
    fetchFn: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return { ok: response.status >= 200 && response.status < 300, status: response.status, text: async () => response.text } as Response;
    }),
    getConfigFn: () => ({ baseUrl: "https://web3.binance.com/build", apiKey: "k", secretKey: "s" }),
    callLog: new BinanceCallLog(),
    now: () => 0,
  };
}

const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";

// REAL response, verbatim, MSFTB, 2026-09-25 12:06:16 UTC (docs/devex-log.md).
const REAL_UNDERLYING_MARKET =
  '{"code":0,"msg":"success","data":{"binanceChainId":"56","tokenContractAddress":"0x80106cb3ead06659a5ad19df39d9b4733863b9b0","platformId":"bstock","assetType":1,"statusInfo":{"openState":true,"marketStatus":null,"reasonCode":"TRADING","reasonMsg":null,"nextOpenTime":null,"nextCloseTime":null},"marketData":{"referencePrice":null,"high52W":"553.7200","low52W":"349.2000","volumeShares24H":"43328","avgDailyVolume1Y":null,"totalShares":null,"marketCap":"3697401866334.00","turnoverRate":null,"amplitude":null,"dividendYield":"0.00720000","latestDividend":"0.910000","peRatioTTM":"27.6400","pbRatio":"8.3600"}},"timestamp":1790337978945,"success":true}';

describe("fetchMarketStatus", () => {
  it("requests the documented endpoint for BSC and the token", async () => {
    const d = deps({ status: 200, text: REAL_UNDERLYING_MARKET });
    await fetchMarketStatus(MSFTB, d);
    const url = new URL(d.fetchFn.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/build/api/v1/dex/market/rwa/underlying-market");
    expect(Object.fromEntries(url.searchParams)).toEqual({ binanceChainId: "56", tokenContractAddress: MSFTB });
  });

  it("parses the real response, nulls included, and reads nothing from marketData", async () => {
    const result = await fetchMarketStatus(MSFTB, deps({ status: 200, text: REAL_UNDERLYING_MARKET }));
    expect(result).toEqual({
      status: "ok",
      openState: true,
      reasonCode: "TRADING",
      marketStatus: null,
      reasonMsg: null,
      nextOpenTime: null,
      nextCloseTime: null,
      fetchedAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain("referencePrice");
  });

  it("keeps the documented closed-market fields when present", async () => {
    const body = {
      code: 0,
      data: { statusInfo: { openState: false, marketStatus: "closed", reasonCode: "MARKET_CLOSED", reasonMsg: "Weekend or Holiday", nextOpenTime: 1790596200000, nextCloseTime: null } },
    };
    const result = await fetchMarketStatus(MSFTB, deps({ status: 200, text: JSON.stringify(body) }));
    expect(result).toMatchObject({
      status: "ok",
      openState: false,
      reasonCode: "MARKET_CLOSED",
      marketStatus: "closed",
      reasonMsg: "Weekend or Holiday",
      nextOpenTime: 1790596200000,
    });
  });

  it.each([
    [
      "the real 40304 compliance refusal",
      { status: 200, text: '{"code":40304,"msg":"Service not available due to compliance restriction"}' },
      "code 40304: Service not available due to compliance restriction",
    ],
    ["an HTTP error", { status: 502, text: "bad gateway" }, "HTTP 502: bad gateway"],
    [
      "a response without statusInfo.openState",
      { status: 200, text: '{"code":0,"data":{"statusInfo":{"reasonCode":"TRADING"}}}' },
      "response has no statusInfo.openState",
    ],
    ["a non-JSON body", { status: 200, text: "<html>" }, "response was not JSON: <html>"],
  ])("is unavailable — never a status — for %s", async (_label, response, reason) => {
    expect(await fetchMarketStatus(MSFTB, deps(response))).toEqual({ status: "unavailable", reason, fetchedAt: expect.any(String) });
  });

  it("is unavailable when the request fails outright", async () => {
    const result = await fetchMarketStatus(MSFTB, deps(new Error("The operation was aborted due to timeout")));
    expect(result).toMatchObject({ status: "unavailable", reason: "The operation was aborted due to timeout" });
  });

  it("keeps the latest status per ticker for the dashboard", () => {
    recordLatestMarketStatus("MSFT", { status: "unavailable", reason: "x", fetchedAt: "t" });
    expect(getLatestMarketStatuses().MSFT).toEqual({ status: "unavailable", reason: "x", fetchedAt: "t" });
  });
});
