import type { Protocol, Quote } from "./types";

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
}

function getConfig(): BinanceWeb3ApiConfig {
  const baseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "NotImplemented: BINANCE_WEB3_API_BASE_URL / BINANCE_WEB3_API_KEY are not set. " +
        "This client is built against the documented Binance Web3 API quote shape " +
        "but has no live credentials configured yet — see .env.example."
    );
  }
  return { baseUrl, apiKey };
}

// Fetches a single live quote for one underlying on one protocol.
// Never returns a fabricated price: throws if unconfigured or if the
// upstream response is malformed, rather than falling back to a
// placeholder number.
export async function fetchQuote(protocol: Protocol, underlying: string): Promise<Quote> {
  const { baseUrl, apiKey } = getConfig();
  const symbol = tokenSymbol(protocol, underlying);

  const res = await fetch(`${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`, {
    headers: { "X-MBX-APIKEY": apiKey },
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
