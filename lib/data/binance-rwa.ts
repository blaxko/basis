import { binanceRequest, defaultBinanceClientDeps, type BinanceClientDeps } from "./binance-client";

// Binance Web3 API, RWA Data: the underlying market's trading status for a
// tokenized stock, from GET /api/v1/dex/market/rwa/underlying-market
// (operationId getRwaUnderlyingMarketData). First real response, MSFTB,
// 2026-09-25 12:06 UTC (docs/devex-log.md):
//   "statusInfo":{"openState":true,"marketStatus":null,"reasonCode":"TRADING",
//                 "reasonMsg":null,"nextOpenTime":null,"nextCloseTime":null}
// marketStatus and the next open/close times can be null even though the
// schema describes them as always set, so every field but openState is
// nullable here.
//
// Only statusInfo is read. The endpoint's marketData.referencePrice (and
// /rwa/price's referencePrice) is, per the schema, "derived from the
// on-chain token price, not an official quote from the traditional stock
// market" — it is never used as an independent price.

const UNDERLYING_MARKET_PATH = "/api/v1/dex/market/rwa/underlying-market";
const BSC_CHAIN_ID = "56";

export type MarketStatus =
  | {
      status: "ok";
      openState: boolean;
      // Decisions use reasonCode only. marketStatus and reasonMsg are
      // recorded and displayed, never string-matched.
      reasonCode: string | null;
      marketStatus: string | null;
      reasonMsg: string | null;
      nextOpenTime: number | null;
      nextCloseTime: number | null;
      fetchedAt: string;
    }
  | { status: "unavailable"; reason: string; fetchedAt: string };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function fetchMarketStatus(
  tokenContractAddress: string,
  deps: BinanceClientDeps = defaultBinanceClientDeps
): Promise<MarketStatus> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await binanceRequest(
      {
        method: "GET",
        path: UNDERLYING_MARKET_PATH,
        query: new URLSearchParams({ binanceChainId: BSC_CHAIN_ID, tokenContractAddress }),
      },
      deps
    );
    if (res.httpStatus < 200 || res.httpStatus >= 300) return { status: "unavailable", reason: `HTTP ${res.httpStatus}: ${res.text.slice(0, 300)}`, fetchedAt };
    if (!res.body) return { status: "unavailable", reason: `response was not JSON: ${res.text.slice(0, 300)}`, fetchedAt };
    if (res.body.code !== 0) return { status: "unavailable", reason: `code ${res.body.code}: ${res.body.msg ?? "no message"}`, fetchedAt };

    const info = (res.body.data as { statusInfo?: Record<string, unknown> } | undefined)?.statusInfo;
    if (!info || typeof info.openState !== "boolean") {
      return { status: "unavailable", reason: "response has no statusInfo.openState", fetchedAt };
    }
    return {
      status: "ok",
      openState: info.openState,
      reasonCode: str(info.reasonCode),
      marketStatus: str(info.marketStatus),
      reasonMsg: str(info.reasonMsg),
      nextOpenTime: num(info.nextOpenTime),
      nextCloseTime: num(info.nextCloseTime),
      fetchedAt,
    };
  } catch (err) {
    return { status: "unavailable", reason: err instanceof Error ? err.message : String(err), fetchedAt };
  }
}

// The most recent status per ticker, for the dashboard header. On
// globalThis so the scheduler bundle and the /api/status route share it.
const LATEST_KEY = Symbol.for("basis.marketStatus.latest");
function latest(): Map<string, MarketStatus> {
  const g = globalThis as unknown as Record<symbol, Map<string, MarketStatus> | undefined>;
  return (g[LATEST_KEY] ??= new Map());
}
export function recordLatestMarketStatus(ticker: string, status: MarketStatus): void {
  latest().set(ticker, status);
}
export function getLatestMarketStatuses(): Record<string, MarketStatus> {
  return Object.fromEntries(latest());
}
