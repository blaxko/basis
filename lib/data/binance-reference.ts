import { parseUnits, type Address } from "viem";
import { binanceRequest, defaultBinanceClientDeps, type BinanceClientDeps } from "./binance-client";

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

interface QuoteRoute {
  vendorName?: string;
  toTokenAmount?: string;
  isBest?: boolean;
  toToken?: { decimal?: string };
  dexRouterList?: Array<{ dexProtocol?: { dexName?: string } }>;
}

export async function fetchAggregatorReference(
  params: { stablecoin: Address; targetToken: Address; sizeUsd: number; userWalletAddress?: string },
  deps: BinanceClientDeps = defaultBinanceClientDeps
): Promise<ReferenceQuote> {
  try {
    deps.getConfigFn();
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

  try {
    const res = await binanceRequest({ method: "GET", path: QUOTE_PATH, query }, deps);
    if (res.httpStatus < 200 || res.httpStatus >= 300) return { status: "unavailable", reason: `HTTP ${res.httpStatus}` };

    const body = res.body as { code?: number; msg?: string; data?: QuoteRoute[] } | null;
    if (!body) return { status: "unavailable", reason: "response was not JSON" };
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
