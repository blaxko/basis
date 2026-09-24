import { describe, it, expect } from "vitest";
import { feeAdjustedPrice } from "./nav-equivalent";
import { rawSpread, adjustedSpread } from "./adjusted-spread";

// The real MSFTB/USDT pool pair found this session (2026-09-24), both on
// PancakeSwap V3 (BSC): 0.25% fee pool at $500.54, 1% fee pool at
// $496.98 — a 0.72% gross gap between two pools of the identical token.
describe("real MSFTB cross-pool gap: does the 0.71% gross spread actually clear fees+slippage+gas?", () => {
  const cheapPoolPriceUsd = 496.98; // 1% fee pool — cheaper by raw price
  const cheapPoolFeeUnits = 10000; // 1%
  const expensivePoolPriceUsd = 500.54; // 0.25% fee pool — more expensive by raw price
  const expensivePoolFeeUnits = 2500; // 0.25%
  const tradeSizeUsd = 200; // matches this codebase's DEFAULT_AGENT_LOOP_CONFIG.orderSizeUsd

  it("the raw gap alone looks like a real 0.71% opportunity", () => {
    const spread = rawSpread(cheapPoolPriceUsd, expensivePoolPriceUsd);
    expect(spread).toBeGreaterThan(0.007);
    expect(spread).toBeLessThan(0.0072);
  });

  it("REPORTED RESULT: net of the cheap pool's own 1% fee, the gap does not survive — this pair is NOT tradeable", () => {
    // Buying on the "cheap" pool costs an extra 1% in that pool's own
    // fee — bigger than the entire 0.71% gross gap on its own, before
    // slippage or gas are even considered.
    const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPoolPriceUsd, cheapPoolFeeUnits, "buy");
    const effectiveSellPriceUsd = feeAdjustedPrice(expensivePoolPriceUsd, expensivePoolFeeUnits, "sell");

    // A realistic BSC PancakeSwap V3 swap: ~200k gas units, ~1.5 gwei gas
    // price, BNB ~$700 (rough order-of-magnitude assumption, not a live
    // quote) — ≈ $0.21 total, negligible next to the fee gap itself but
    // included for completeness.
    const gasCostUsd = 200_000 * 1.5e-9 * 700;
    const slippagePct = 0.0005; // 0.05%, a thin $200 trade against >$100k pool depth

    const spread = adjustedSpread({
      effectiveBuyPriceUsd,
      effectiveSellPriceUsd,
      slippagePct,
      gasCostUsd,
      tradeSizeUsd,
    });

    // Net result: approximately -0.69% — the cheap pool's own 1% fee
    // alone exceeds the gross gap. This pairing is not a real edge.
    expect(spread).toBeLessThan(0);
    expect(spread).toBeCloseTo(-0.0069, 3);
  });

  it("the same pair WOULD clear if both pools charged the cheaper 0.25% fee instead (isolating that the fee tier, not the mechanism, is what kills this specific pairing)", () => {
    const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPoolPriceUsd, 2500, "buy");
    const effectiveSellPriceUsd = feeAdjustedPrice(expensivePoolPriceUsd, 2500, "sell");
    const gasCostUsd = 200_000 * 1.5e-9 * 700;

    const spread = adjustedSpread({
      effectiveBuyPriceUsd,
      effectiveSellPriceUsd,
      slippagePct: 0.0005,
      gasCostUsd,
      tradeSizeUsd,
    });

    expect(spread).toBeGreaterThan(0);
  });
});

describe("adjustedSpread — a small gap that should correctly return no trade", () => {
  it("a 0.1% raw gap between two same-fee-tier pools never clears even minimal costs", () => {
    const cheapPriceUsd = 500.0;
    const expensivePriceUsd = 500.5; // 0.1% higher
    const feeUnits = 2500; // 0.25% each side — 0.5% total just in fees

    const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPriceUsd, feeUnits, "buy");
    const effectiveSellPriceUsd = feeAdjustedPrice(expensivePriceUsd, feeUnits, "sell");

    const spread = adjustedSpread({
      effectiveBuyPriceUsd,
      effectiveSellPriceUsd,
      slippagePct: 0.0002,
      gasCostUsd: 0.15,
      tradeSizeUsd: 200,
    });

    expect(spread).toBeLessThan(0);
  });
});

describe("adjustedSpread — sign behavior on already fee-adjusted prices", () => {
  it("is positive when the effective sell price exceeds the effective buy price", () => {
    const spread = adjustedSpread({
      effectiveBuyPriceUsd: 100,
      effectiveSellPriceUsd: 101,
      slippagePct: 0,
      gasCostUsd: 0,
      tradeSizeUsd: 1000,
    });
    expect(spread).toBeCloseTo(0.01, 5);
  });

  it("is negative when the effective sell price is below the effective buy price", () => {
    const spread = adjustedSpread({
      effectiveBuyPriceUsd: 100,
      effectiveSellPriceUsd: 99,
      slippagePct: 0,
      gasCostUsd: 0,
      tradeSizeUsd: 1000,
    });
    expect(spread).toBeCloseTo(-0.01, 5);
  });

  it("gas cost is correctly expressed as a fraction of trade size, larger trades dilute it", () => {
    const smallTrade = adjustedSpread({
      effectiveBuyPriceUsd: 100,
      effectiveSellPriceUsd: 100,
      slippagePct: 0,
      gasCostUsd: 1,
      tradeSizeUsd: 100,
    });
    const largeTrade = adjustedSpread({
      effectiveBuyPriceUsd: 100,
      effectiveSellPriceUsd: 100,
      slippagePct: 0,
      gasCostUsd: 1,
      tradeSizeUsd: 10000,
    });
    expect(smallTrade).toBeLessThan(largeTrade);
  });
});
