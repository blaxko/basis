import { createHmac } from "node:crypto";
import type { Address } from "viem";
import type { Protocol, Quote, PoolQuote } from "./types";
import { getPoolsForTicker } from "./pool-addresses";
import { readPoolPrice } from "./pancakeswap-v3";

// Ticker suffix convention confirmed live on BNB Chain as of Sep 2026:
// Ondo total-return tokens use an "on" suffix (NVDAon, AAPLon, ...);
// xStocks/bStocks use plain or protocol-tagged tickers. Adjust here if
// the live Binance Web3 API symbol format differs once credentials land.
const SYMBOL_SUFFIX: Record<Protocol, string> = {
  xstocks: "x",
  bstocks: "b",
  ondo: "on",
};

export function tokenSymbol(protocol: Protocol, underlying: string): string {
  return `${underlying}${SYMBOL_SUFFIX[protocol]}`;
}

interface BinanceWeb3ApiConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
}

function getConfig(): BinanceWeb3ApiConfig {
  const baseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const secretKey = process.env.BINANCE_WEB3_API_SECRET;
  if (!baseUrl || !apiKey || !secretKey) {
    throw new Error(
      "NotImplemented: BINANCE_WEB3_API_BASE_URL / BINANCE_WEB3_API_KEY / " +
        "BINANCE_WEB3_API_SECRET are not set. This client is built against the " +
        "documented Binance Web3 API quote shape but has no live credentials " +
        "configured yet — see .env.example."
    );
  }
  return { baseUrl, apiKey, secretKey };
}

// Real HMAC-SHA256 signing scheme per web3.binance.com/en/dev-docs/authentication
// (confirmed against actual docs, not a guess): preHash = timestamp + method +
// requestPath + body; signature = base64(HMAC-SHA256(preHash, secretKey)).
// requestPath is the URL's path + query string, and must include the API's
// own "/build" prefix baked into the base URL — signing only the suffix
// after it would produce a signature the server rejects.
//
// `timestamp` is an injectable parameter (defaulting to "now"), the same
// pattern used everywhere else in this codebase for time-dependent
// values (see lib/orchestration/spend-tracker.ts) — it's what makes this
// function deterministically testable.
export function buildAuthHeaders(
  apiKey: string,
  secretKey: string,
  method: string,
  url: string,
  body = "",
  timestamp: string = new Date().toISOString()
): Record<string, string> {
  const { pathname, search } = new URL(url);
  const requestPath = pathname + search;
  const preHash = `${timestamp}${method}${requestPath}${body}`;
  const signature = createHmac("sha256", secretKey).update(preHash).digest("base64");

  return {
    "X-OC-APIKEY": apiKey,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": signature,
  };
}

// Fetches a single live quote for one underlying on one protocol.
// Never returns a fabricated price: throws if unconfigured or if the
// upstream response is malformed, rather than falling back to a
// placeholder number.
export async function fetchQuote(protocol: Protocol, underlying: string): Promise<Quote> {
  const { baseUrl, apiKey, secretKey } = getConfig();
  const symbol = tokenSymbol(protocol, underlying);
  const url = `${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`;

  const res = await fetch(url, {
    headers: buildAuthHeaders(apiKey, secretKey, "GET", url),
  });

  if (!res.ok) {
    throw new Error(`Binance Web3 API quote request failed for ${symbol}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const price = Number(data.price);
  const liquidityDepth = Number(data.liquidityDepth ?? data.depth);

  if (!Number.isFinite(price) || !Number.isFinite(liquidityDepth)) {
    throw new Error(`Binance Web3 API returned a malformed quote for ${symbol}: ${JSON.stringify(data)}`);
  }

  return {
    protocol,
    underlying,
    symbol,
    price,
    liquidityDepth,
    timestamp: Date.now(),
  };
}

// Fetches quotes for every underlying across all three protocols.
export async function fetchQuotes(underlyings: string[]): Promise<Quote[]> {
  const protocols: Protocol[] = ["xstocks", "bstocks", "ondo"];
  const calls = underlyings.flatMap((underlying) =>
    protocols.map((protocol) => fetchQuote(protocol, underlying))
  );
  return Promise.all(calls);
}

export const MVP_UNDERLYINGS = ["NVDA", "AAPL", "MSFT", "TSLA"] as const;

// BSC-pegged USDT — the stablecoin every currently-registered pool in
// lib/data/pool-addresses.ts is paired against (confirmed via the
// on-chain token0()/token1() reads this session). If a future pool pairs
// against a different stablecoin, PoolDescriptor would need its own
// stablecoin field rather than assuming this one constant.
export const BSC_USDT_ADDRESS: Address = "0x55d398326f99059fF775485246999027B3197955";

// Reads live prices for every known PancakeSwap V3 pool of a ticker's
// token — the new detection unit, replacing the single aggregated quote
// fetchQuote() above returns. Read-only: no wallet, no signing, nothing
// beyond lib/data/pancakeswap-v3.ts's existing on-chain reads.
export async function fetchPoolQuotes(ticker: string): Promise<PoolQuote[]> {
  const pools = getPoolsForTicker(ticker);
  const timestamp = Date.now();

  const results = await Promise.all(
    pools.map((pool) => readPoolPrice(pool.address as Address, BSC_USDT_ADDRESS, pool.feeUnits))
  );

  return results.map((result) => ({
    ticker,
    poolAddress: result.poolAddress,
    feeUnits: result.feeUnits,
    priceUsd: result.priceUsd,
    liquidityUsdEstimate: result.liquidityUsdEstimate,
    timestamp,
  }));
}
