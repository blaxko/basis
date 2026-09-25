import { parseUnits, type Address } from "viem";
import { buildAuthHeaders, getConfig, type BinanceWeb3ApiConfig } from "./quotes";

// The Binance Web3 aggregator's price for buying the target token with
// the stablecoin at a given size — an independent reference to
// sanity-check pool-derived prices against. Never a fabricated value:
// anything short of a clean, parseable quote is "unavailable", with the
// reason, and the guardrail fails closed on it.
export type ReferenceQuote =
  | { status: "ok"; priceUsd: number; vendor: string; route: string }
  | { status: "unavailable"; reason: string };

// Endpoint and parameters per the Binance Web3 API OpenAPI schema
// (web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/1.0.0/schema.json,
// operationId getAggregatedQuote), checked 2026-09-24. Routes come back
// sorted by toTokenAmount, best first; `isBest` marks the best one.
// `userWalletAddress` is required for RFQ routes (bStock/Ondo).
const QUOTE_PATH = "/api/v1/dex/aggregator/quote";
const STABLECOIN_DECIMALS = 18; // BSC USDT
const TIMEOUT_MS = 10_000;

interface QuoteRoute {
  vendorName?: string;
  toTokenAmount?: string;
  isBest?: boolean;
  toToken?: { decimal?: string };
  dexRouterList?: Array<{ dexProtocol?: { dexName?: string } }>;
}

export interface ReferenceDeps {
  fetchFn: typeof fetch;
  getConfigFn: () => BinanceWeb3ApiConfig;
}

const defaultDeps: ReferenceDeps = { fetchFn: (...args) => fetch(...args), getConfigFn: getConfig };

export async function fetchAggregatorReference(
  params: { stablecoin: Address; targetToken: Address; sizeUsd: number; userWalletAddress?: string },
  deps: ReferenceDeps = defaultDeps
): Promise<ReferenceQuote> {
  let config: BinanceWeb3ApiConfig;
  try {
    config = deps.getConfigFn();
  } catch {
    return { status: "unavailable", reason: "Binance Web3 API credentials not configured" };
  }

  const query = new URLSearchParams({
    binanceChainId: "56",
    amount: parseUnits(params.sizeUsd.toFixed(6), STABLECOIN_DECIMALS).toString(),
    fromTokenAddress: params.stablecoin,
    toTokenAddress: params.targetToken,
  });
  if (params.userWalletAddress) query.set("userWalletAddress", params.userWalletAddress);
  const url = `${config.baseUrl}${QUOTE_PATH}?${query}`;

  try {
    const res = await deps.fetchFn(url, {
      method: "GET",
      headers: buildAuthHeaders(config.apiKey, config.secretKey, "GET", url),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: "unavailable", reason: `HTTP ${res.status}` };

    const body = (await res.json()) as { code?: number; msg?: string; data?: QuoteRoute[] };
    if (body.code !== 0) return { status: "unavailable", reason: `code ${body.code}: ${body.msg ?? "no message"}` };

    const routes = Array.isArray(body.data) ? body.data : [];
    const best = routes.find((r) => r.isBest) ?? routes[0];
    if (!best) return { status: "unavailable", reason: "no routes returned" };

    const decimals = Number(best.toToken?.decimal);
    const out = Number(best.toTokenAmount) / 10 ** decimals;
    const priceUsd = params.sizeUsd / out;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return { status: "unavailable", reason: `malformed route: toTokenAmount=${best.toTokenAmount}, decimal=${best.toToken?.decimal}` };
    }

    const route = (best.dexRouterList ?? []).map((d) => d.dexProtocol?.dexName ?? "?").join(" + ") || "unknown";
    return { status: "ok", priceUsd, vendor: best.vendorName ?? "unknown", route };
  } catch (err) {
    return { status: "unavailable", reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
  }
}
