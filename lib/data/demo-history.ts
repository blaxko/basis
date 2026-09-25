import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { rawSpread, adjustedSpread } from "../basis-model/adjusted-spread";
import type { ReferenceQuote } from "./binance-reference";

export interface SpreadHistoryPoint {
  timestamp: string; // ISO 8601 — hourly, not daily (real DEX data has no "trading day" concept)
  cheapPoolPriceUsd: number;
  cheapPoolFeeUnits: number;
  expensivePoolPriceUsd: number;
  expensivePoolFeeUnits: number;
  rawSpread: number;
  adjustedSpread: number; // net edge after both pools' fees, slippage, and gas
  // Binance aggregator reference at the time; null for the seeded
  // fixture, which predates it.
  reference: ReferenceQuote | null;
}

// Seeded demo fixture, not live data — but unlike the old dividend-drift
// series, every point here is a REAL matched-timestamp reading from this
// session's research: hourly OHLCV close prices for MSFTB's two real
// PancakeSwap V3 pools (0.25% fee: 0x5018b018ceb7645c927c5cf246786f89ebcbe7ea,
// 1% fee: 0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44), matched at the
// nearest available hourly candle for each pool (the 1% pool trades far
// less often — 7 distinct hourly candles across this 4-day window vs.
// 96 for the 0.25% pool, itself a real finding: thin liquidity is part
// of why this pairing isn't a clean arbitrage). Spread sign flips
// between points, same as the real data — not curated to always favor
// one direction.
const GAS_COST_USD_ESTIMATE = 200_000 * 1.5e-9 * 700; // ~200k gas units, ~1.5 gwei, BNB ~$700
const SLIPPAGE_PCT_ESTIMATE = 0.0005; // 0.05%, thin $200 trade against real pool depth

interface RawPoint {
  timestamp: string;
  price25: number; // 0.25% fee pool close
  price1: number; // 1% fee pool close
}

const MSFTB_RAW_POINTS: RawPoint[] = [
  { timestamp: "2026-09-18T04:00:00Z", price25: 494.83, price1: 502.59 },
  { timestamp: "2026-09-18T13:00:00Z", price25: 492.55, price1: 492.88 },
  { timestamp: "2026-09-18T14:00:00Z", price25: 493.83, price1: 490.23 },
  { timestamp: "2026-09-19T06:00:00Z", price25: 493.73, price1: 492.71 },
  { timestamp: "2026-09-20T04:00:00Z", price25: 492.22, price1: 490.42 },
  { timestamp: "2026-09-20T17:00:00Z", price25: 498.19, price1: 500.37 },
  { timestamp: "2026-09-21T20:00:00Z", price25: 500.04, price1: 500.51 },
];

const FEE_25 = 2500;
const FEE_1PCT = 10000;

function buildMsftbDemoHistory(): SpreadHistoryPoint[] {
  return MSFTB_RAW_POINTS.map(({ timestamp, price25, price1 }) => {
    const cheapIs25 = price25 <= price1;
    const cheapPoolPriceUsd = cheapIs25 ? price25 : price1;
    const cheapPoolFeeUnits = cheapIs25 ? FEE_25 : FEE_1PCT;
    const expensivePoolPriceUsd = cheapIs25 ? price1 : price25;
    const expensivePoolFeeUnits = cheapIs25 ? FEE_1PCT : FEE_25;

    const raw = rawSpread(cheapPoolPriceUsd, expensivePoolPriceUsd);
    const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPoolPriceUsd, cheapPoolFeeUnits, "buy");
    const effectiveSellPriceUsd = feeAdjustedPrice(expensivePoolPriceUsd, expensivePoolFeeUnits, "sell");
    const adjusted = adjustedSpread({
      effectiveBuyPriceUsd,
      effectiveSellPriceUsd,
      slippagePct: SLIPPAGE_PCT_ESTIMATE,
      gasCostUsd: GAS_COST_USD_ESTIMATE,
      tradeSizeUsd: 200,
    });

    return {
      timestamp,
      cheapPoolPriceUsd,
      cheapPoolFeeUnits,
      expensivePoolPriceUsd,
      expensivePoolFeeUnits,
      rawSpread: raw,
      adjustedSpread: adjusted,
      reference: null,
    };
  });
}

const DEMO_HISTORY: Record<string, () => SpreadHistoryPoint[]> = {
  MSFT: buildMsftbDemoHistory,
};

// Returns the seeded demo series for underlyings we have one for (MSFT),
// or an empty array otherwise — callers fall back to a single live point.
export function getDemoHistory(ticker: string): SpreadHistoryPoint[] {
  return DEMO_HISTORY[ticker]?.() ?? [];
}
