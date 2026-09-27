import { parseUnits } from "viem";
import { binanceRequest, type BinanceResponse } from "../data/binance-client";
import { BSC_USDT_ADDRESS } from "../data/quotes";
import { logServerError, plainNetworkReason, safeDetail } from "../errors/public-error";

// Cross-issuer MSFT recorder: READ-ONLY. It never builds an order, never
// signs, never sends — it records how Microsoft's token from three issuers
// (bStocks MSFTB, xStocks MSFTx, Ondo MSFTon) is priced on BSC, per share,
// through Binance's Trading API quotes at the same USDT size. Monitor only:
// Basis doesn't trade across issuers.
//
// Addresses: each confirmed by the issuer's own published data and by the
// chain itself (name/symbol/decimals read over the BSC RPC) on 2026-09-26
// (basis-assessment/issuer-verification/verification.md, outside the
// repo), and at runtime by Binance's RWA API (/rwa/price must return the
// address with the issuer's platformId). A token failing any check is left
// out, with the reason in status().

export interface IssuerToken {
  issuer: "bStocks" | "xStocks" | "Ondo";
  symbol: "MSFTB" | "MSFTx" | "MSFTon";
  address: `0x${string}`;
  decimals: 18;
  // Binance RWA platformId expected for this issuer.
  platformMatch: RegExp;
  // sharesMultiplier as published by the issuer, 2026-09-26 (see above).
  publishedMultiplier: number;
}

export const MSFT_ISSUER_TOKENS: readonly IssuerToken[] = [
  // bstocks.finance asset data: caList BSC, "ml" 1.001313964833366845
  { issuer: "bStocks", symbol: "MSFTB", address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0", decimals: 18, platformMatch: /bstock/i, publishedMultiplier: 1.001313964833366845 },
  // api.xstocks.fi/api/v2/public/assets/MSFTx: BinanceSmartChain; multiplier 1.0059033904787456
  { issuer: "xStocks", symbol: "MSFTx", address: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35", decimals: 18, platformMatch: /xstock/i, publishedMultiplier: 1.0059033904787456 },
  // app.ondo.finance/assets/msfton: BSC chainId 56; sharesMultiplier 1.005730856892783903
  { issuer: "Ondo", symbol: "MSFTon", address: "0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3", decimals: 18, platformMatch: /ondo/i, publishedMultiplier: 1.005730856892783903 },
];

export const QUOTE_SIZE_USD = 200; // same size as the cross-pool reference quote
export const SLOW_EVERY_TICKS = 10; // /rwa/price + sell quotes every 5 min
export const MULTIPLIER_TOLERANCE = 0.0005; // Binance-implied vs issuer-published
// A per-share buy further than this from bStocks' per-share buy is treated
// as a bad quote, not a price: recorded as an error with its raw fields.
export const PLAUSIBLE_DEVIATION = 0.2;
export const MAX_READINGS = 2_880; // 24 h at 30 s
const STAGGER_MS = 300; // stays under Binance's 5 requests/s per endpoint
export const LABEL = "Monitor only: Basis doesn't trade across issuers";

// ---- Pure parts --------------------------------------------------------

// Binance docs: referencePrice = tokenPrice ÷ sharesMultiplier.
export function impliedMultiplier(tokenPrice: number, referencePrice: number): number {
  return tokenPrice / referencePrice;
}

export interface RwaPriceRow {
  tokenContractAddress: string;
  platformId?: string;
  tokenPrice?: string;
  referencePrice?: string;
}

export interface TokenConfirmation {
  symbol: IssuerToken["symbol"];
  issuer: IssuerToken["issuer"];
  address: string;
  included: boolean;
  reason?: string;
  platformId: string | null;
  multiplier: number | null; // Binance-implied
  publishedMultiplier: number;
  multiplierMatches: boolean;
  // The /rwa/price row Binance returned for this address, verbatim.
  binanceRow?: RwaPriceRow;
}

export function confirmTokens(tokens: readonly IssuerToken[], rows: readonly RwaPriceRow[]): TokenConfirmation[] {
  return tokens.map((token) => {
    const base = { symbol: token.symbol, issuer: token.issuer, address: token.address, publishedMultiplier: token.publishedMultiplier };
    const row = rows.find((r) => r.tokenContractAddress?.toLowerCase() === token.address);
    if (!row) return { ...base, included: false, reason: "not returned by Binance's RWA API", platformId: null, multiplier: null, multiplierMatches: false };
    const platformId = row.platformId ?? null;
    if (!platformId) {
      return { ...base, binanceRow: row, included: false, reason: `Binance's RWA API returned it without a platformId, so it can't be confirmed as ${token.issuer}`, platformId, multiplier: null, multiplierMatches: false };
    }
    if (!token.platformMatch.test(platformId)) {
      return { ...base, binanceRow: row, included: false, reason: `Binance's RWA API lists it under platform "${platformId}", not ${token.issuer}`, platformId, multiplier: null, multiplierMatches: false };
    }
    const tokenPrice = Number(row.tokenPrice);
    const referencePrice = Number(row.referencePrice);
    const multiplier = Number.isFinite(tokenPrice) && Number.isFinite(referencePrice) && referencePrice > 0 ? impliedMultiplier(tokenPrice, referencePrice) : null;
    const multiplierMatches = multiplier !== null && Math.abs(multiplier / token.publishedMultiplier - 1) <= MULTIPLIER_TOLERANCE;
    if (!multiplierMatches) {
      return {
        ...base,
        binanceRow: row,
        included: false,
        reason: `Binance's implied multiplier ${multiplier?.toFixed(6) ?? "unavailable"} differs from ${token.issuer}'s published ${token.publishedMultiplier.toFixed(6)} by more than ${MULTIPLIER_TOLERANCE * 100}%`,
        platformId,
        multiplier,
        multiplierMatches: false,
      };
    }
    return { ...base, binanceRow: row, included: true, platformId, multiplier, multiplierMatches: true };
  });
}

export interface TokenInput {
  token: IssuerToken;
  multiplier: number;
  buyPerToken?: number; // USD per token, buying with USDT at QUOTE_SIZE_USD
  sellPerToken?: number; // USD per token, selling for USDT
  sellAgeS?: number;
  error?: string;
}

export interface TokenReading {
  symbol: IssuerToken["symbol"];
  issuer: IssuerToken["issuer"];
  multiplier: number;
  buyPerToken: number | null;
  buyPerShare: number | null;
  sellPerShare: number | null;
  sellAgeS: number | null;
  error?: string;
}

export interface IssuerReading {
  t: number;
  tokens: TokenReading[];
  // Per-share buy prices: cheapest vs dearest issuer.
  gap: { cheapest: string; dearest: string; grossPct: number } | null;
  // Best "buy one issuer, sell another" per share, after the quotes' own
  // fees and price impact and an estimate of gas for the two swaps.
  roundTrip: { buy: string; sell: string; netPct: number; gasUsd: number; clears: boolean } | null;
}

export function buildReading(input: { t: number; tokens: TokenInput[]; gasUsd: number; sizeUsd: number }): IssuerReading {
  const tokens: TokenReading[] = input.tokens.map((x) => ({
    symbol: x.token.symbol,
    issuer: x.token.issuer,
    multiplier: x.multiplier,
    buyPerToken: x.buyPerToken ?? null,
    buyPerShare: x.buyPerToken !== undefined ? x.buyPerToken / x.multiplier : null,
    sellPerShare: x.sellPerToken !== undefined ? x.sellPerToken / x.multiplier : null,
    sellAgeS: x.sellAgeS ?? null,
    ...(x.error ? { error: x.error } : {}),
  }));
  const bought = tokens.filter((x) => x.buyPerShare !== null);
  let gap: IssuerReading["gap"] = null;
  if (bought.length >= 2) {
    const sorted = [...bought].sort((a, b) => a.buyPerShare! - b.buyPerShare!);
    const lo = sorted[0]!, hi = sorted[sorted.length - 1]!;
    gap = { cheapest: lo.symbol, dearest: hi.symbol, grossPct: (hi.buyPerShare! - lo.buyPerShare!) / lo.buyPerShare! };
  }
  let roundTrip: IssuerReading["roundTrip"] = null;
  const gasFraction = input.sizeUsd > 0 ? input.gasUsd / input.sizeUsd : 0;
  for (const a of bought) {
    for (const b of tokens) {
      if (a === b || b.sellPerShare === null) continue;
      const netPct = (b.sellPerShare - a.buyPerShare!) / a.buyPerShare! - gasFraction;
      if (!roundTrip || netPct > roundTrip.netPct) roundTrip = { buy: a.symbol, sell: b.symbol, netPct, gasUsd: input.gasUsd, clears: netPct > 0 };
    }
  }
  return { t: input.t, tokens, gap, roundTrip };
}

// ---- The recorder ------------------------------------------------------

type RequestFn = (request: { method: "GET"; path: string; query: URLSearchParams }) => Promise<BinanceResponse>;

export interface RecorderDeps {
  request: RequestFn;
  // The scheduler's own $200 USDT→MSFTB quote this tick (reused: no extra call).
  latestMsftbBuy: () => { priceUsdPerToken: number; at: number } | null;
  latestGasUsd: () => number | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  userWalletAddress?: string;
}

const QUOTE_PATH = "/api/v1/dex/aggregator/quote";
const RWA_PRICE_PATH = "/api/v1/dex/market/rwa/price";

// The fields of the chosen route that decide the price, verbatim: kept
// per token and side in status() so a surprising number can be checked
// against exactly what Binance returned.
export interface RawQuote {
  at: number;
  vendorName?: string;
  executionMode?: string;
  fromTokenAmount?: string;
  toTokenAmount?: string;
  toTokenDecimal?: string;
  toTokenSymbol?: string;
  toTokenUnitPrice?: string;
  routes: number;
}

type QuoteResult = { ok: true; out: number; vendor: string; raw: RawQuote } | { ok: false; reason: string };

export class CrossIssuerRecorder {
  private ticks = 0;
  private confirmations: TokenConfirmation[] = [];
  private lastConfirmedAt: number | null = null;
  private sells = new Map<string, { perToken: number; at: number }>();
  private lastBuy = new Map<string, number>();
  private buffer: IssuerReading[] = [];
  private callTimes: number[] = [];
  private rawQuotes: Record<string, RawQuote> = {};

  constructor(private readonly deps: RecorderDeps) {}

  async tick(): Promise<IssuerReading | null> {
    const now = this.deps.now();
    const slow = this.ticks % SLOW_EVERY_TICKS === 0;
    this.ticks += 1;

    if (slow) await this.confirm();
    const included = this.confirmations.filter((c) => c.included);
    if (included.length === 0) return null;

    const inputs: TokenInput[] = [];
    for (const c of included) {
      const token = MSFT_ISSUER_TOKENS.find((t) => t.symbol === c.symbol)!;
      const input: TokenInput = { token, multiplier: c.multiplier! };
      const reused = token.symbol === "MSFTB" ? this.deps.latestMsftbBuy() : null;
      if (reused && now - reused.at <= 60_000) {
        input.buyPerToken = reused.priceUsdPerToken;
      } else {
        const q = await this.quote(BSC_USDT_ADDRESS, token.address, parseUnits(QUOTE_SIZE_USD.toFixed(6), 18));
        if (q.ok) {
          this.rawQuotes[`${token.symbol}_buy`] = q.raw;
          input.buyPerToken = QUOTE_SIZE_USD / q.out;
        } else input.error = q.reason;
      }
      inputs.push(input);
    }

    // A per-share price far from bStocks' is a bad quote, not a price.
    const anchor = inputs.find((x) => x.token.symbol === "MSFTB" && x.buyPerToken !== undefined);
    const anchorPerShare = anchor ? anchor.buyPerToken! / anchor.multiplier : null;
    for (const input of inputs) {
      if (input.buyPerToken === undefined) continue;
      const perShare = input.buyPerToken / input.multiplier;
      if (anchorPerShare !== null && Math.abs(perShare / anchorPerShare - 1) > PLAUSIBLE_DEVIATION) {
        input.error = `implausible quote: $${perShare.toPrecision(6)} per share vs bStocks $${anchorPerShare.toFixed(2)} (raw quote in status)`;
        delete input.buyPerToken;
        continue;
      }
      this.lastBuy.set(input.token.symbol, input.buyPerToken);
    }

    if (slow) {
      for (const input of inputs) {
        const perToken = this.lastBuy.get(input.token.symbol);
        if (perToken === undefined) continue;
        const tokensIn = QUOTE_SIZE_USD / perToken;
        const q = await this.quote(input.token.address, BSC_USDT_ADDRESS, parseUnits(tokensIn.toFixed(12), 18));
        if (q.ok) {
          this.rawQuotes[`${input.token.symbol}_sell`] = q.raw;
          this.sells.set(input.token.symbol, { perToken: q.out / tokensIn, at: now });
        }
        else input.error = input.error ?? `sell quote: ${q.reason}`;
      }
    }
    for (const input of inputs) {
      const s = this.sells.get(input.token.symbol);
      if (s) {
        input.sellPerToken = s.perToken;
        input.sellAgeS = Math.round((now - s.at) / 1000);
      }
    }

    const reading = buildReading({ t: now, tokens: inputs, gasUsd: this.deps.latestGasUsd() ?? 0, sizeUsd: QUOTE_SIZE_USD });
    this.buffer.push(reading);
    if (this.buffer.length > MAX_READINGS) this.buffer.splice(0, this.buffer.length - MAX_READINGS);
    // One compact line per reading in the server log: a second copy of the
    // raw data, independent of the in-memory buffer (lost on restart).
    this.deps.log(`[basis:issuers] ${JSON.stringify(reading)}`);
    return reading;
  }

  readings(): readonly IssuerReading[] {
    return this.buffer;
  }

  status() {
    const now = this.deps.now();
    this.callTimes = this.callTimes.filter((t) => now - t < 60_000);
    return {
      label: LABEL,
      tokens: this.confirmations,
      lastConfirmedAt: this.lastConfirmedAt,
      // Planned: 2 buy quotes per 30 s + (1 /rwa/price + 3 sell quotes) per 5 min.
      callsPerMinuteBudget: 2 * 2 + (1 + MSFT_ISSUER_TOKENS.length) / 5,
      callsLastMinute: this.callTimes.length,
      readings: this.buffer.length,
      lastQuotes: { ...this.rawQuotes },
    };
  }

  private async confirm(): Promise<void> {
    const query = new URLSearchParams({
      binanceChainId: "56",
      tokenContractAddresses: MSFT_ISSUER_TOKENS.map((t) => t.address).join(","),
    });
    const res = await this.call(RWA_PRICE_PATH, query);
    if (!res.ok) {
      // Keep the previous confirmation if there was one; otherwise nothing
      // is included until Binance answers.
      if (this.confirmations.length === 0) {
        this.confirmations = MSFT_ISSUER_TOKENS.map((t) => ({ symbol: t.symbol, issuer: t.issuer, address: t.address, included: false, reason: `Binance's RWA API: ${res.reason}`, platformId: null, multiplier: null, publishedMultiplier: t.publishedMultiplier, multiplierMatches: false }));
      }
      return;
    }
    const rows = Array.isArray(res.body.data) ? (res.body.data as RwaPriceRow[]) : [];
    this.confirmations = confirmTokens(MSFT_ISSUER_TOKENS, rows);
    this.lastConfirmedAt = this.deps.now();
  }

  private async quote(from: string, to: string, amount: bigint): Promise<QuoteResult> {
    const query = new URLSearchParams({ binanceChainId: "56", amount: amount.toString(), fromTokenAddress: from, toTokenAddress: to });
    if (this.deps.userWalletAddress) query.set("userWalletAddress", this.deps.userWalletAddress);
    const res = await this.call(QUOTE_PATH, query);
    if (!res.ok) return res;
    type Route = { isBest?: boolean; toTokenAmount?: string; fromTokenAmount?: string; executionMode?: string; toToken?: { decimal?: string; tokenSymbol?: string; tokenUnitPrice?: string }; vendorName?: string };
    const routes = Array.isArray(res.body.data) ? (res.body.data as Route[]) : [];
    const best = routes.find((r) => r.isBest) ?? routes[0];
    const raw: RawQuote = {
      at: this.deps.now(),
      vendorName: best?.vendorName,
      executionMode: best?.executionMode,
      fromTokenAmount: best?.fromTokenAmount,
      toTokenAmount: best?.toTokenAmount,
      toTokenDecimal: best?.toToken?.decimal,
      toTokenSymbol: best?.toToken?.tokenSymbol,
      toTokenUnitPrice: best?.toToken?.tokenUnitPrice,
      routes: routes.length,
    };
    const out = best ? Number(best.toTokenAmount) / 10 ** Number(best.toToken?.decimal) : NaN;
    if (!Number.isFinite(out) || out <= 0) return { ok: false, reason: "no usable route" };
    return { ok: true, out, vendor: best?.vendorName ?? "unknown", raw };
  }

  private async call(path: string, query: URLSearchParams): Promise<{ ok: true; body: { data?: unknown } } | { ok: false; reason: string }> {
    if (this.callTimes.length > 0) await this.deps.sleep(STAGGER_MS);
    this.callTimes.push(this.deps.now());
    try {
      const res = await this.deps.request({ method: "GET", path, query });
      if (res.httpStatus < 200 || res.httpStatus >= 300) return { ok: false, reason: `HTTP ${res.httpStatus}` };
      if (!res.body) return { ok: false, reason: "response was not JSON" };
      if (res.body.code !== 0) return { ok: false, reason: `code ${res.body.code}: ${safeDetail(res.body.msg ?? "no message")}` };
      return { ok: true, body: res.body };
    } catch (err) {
      logServerError(`cross-issuer ${path} failed`, err);
      return { ok: false, reason: `Binance: ${plainNetworkReason(err)}` };
    }
  }
}

// The process-wide recorder (on globalThis: instrumentation.ts runs it, the
// /api/issuers route reads it — separate bundles, like the ledger).
const KEY = Symbol.for("basis.crossIssuer.recorder");
export function defaultRecorder(extra: Partial<RecorderDeps> = {}): CrossIssuerRecorder {
  const g = globalThis as unknown as Record<symbol, CrossIssuerRecorder | undefined>;
  return (g[KEY] ??= new CrossIssuerRecorder({
    request: (r) => binanceRequest(r),
    latestMsftbBuy: () => null,
    latestGasUsd: () => null,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
    ...extra,
  }));
}
