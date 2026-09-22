import { describe, it, expect } from "vitest";
import { navEquivalent } from "./nav-equivalent";
import { rawSpread, adjustedSpread } from "./adjusted-spread";
import { accruedDividend } from "../data/dividend-calendar";

// This is the proof the product's thesis rests on: a raw price-return
// vs. total-return diff false-positives on an ex-dividend date, and the
// NAV-adjusted spread correctly suppresses that false positive.
describe("dividend-drift false positive suppression (MSFT ex-div 2025-08-21, $0.83/share)", () => {
  const symbol = "MSFT";
  const preExDivPrice = 420.0;
  const dividendPerShare = 0.83;
  const exDivDate = "2025-08-21";
  const dayBeforeExDiv = "2025-08-20";

  it("raw spread is ~zero the day before the ex-dividend date", () => {
    const priceReturnPrice = preExDivPrice;
    const ondoPrice = preExDivPrice;
    const accrued = accruedDividend(symbol, dayBeforeExDiv);
    expect(accrued).toBe(0);

    const spread = rawSpread(ondoPrice, priceReturnPrice);
    expect(Math.abs(spread)).toBeLessThan(0.0005);
  });

  it("raw spread false-positives on the ex-dividend date", () => {
    // xStocks/bStocks (price-return) drop by the ex-div adjustment;
    // Ondo (total-return) holds flat because the dividend is reinvested,
    // not paid out.
    const priceReturnPrice = preExDivPrice - dividendPerShare;
    const ondoPrice = preExDivPrice;

    const spread = rawSpread(ondoPrice, priceReturnPrice);
    // A naive bot sees ~0.2% and reads it as "xStocks is cheap" — a
    // real-looking signal that is pure structural drift.
    expect(spread).toBeGreaterThan(0.0015);
  });

  it("adjusted spread suppresses the same scenario to ~zero", () => {
    const priceReturnPrice = preExDivPrice - dividendPerShare;
    const ondoPrice = preExDivPrice;

    const accrued = accruedDividend(symbol, exDivDate);
    expect(accrued).toBeCloseTo(dividendPerShare, 5);

    const navEq = navEquivalent(ondoPrice, accrued);
    const spread = adjustedSpread(navEq, priceReturnPrice);

    expect(Math.abs(spread)).toBeLessThan(0.0005);
  });
});

describe("adjustedSpread", () => {
  it("is positive when the NAV-equivalent price exceeds the price-return price", () => {
    expect(adjustedSpread(101, 100)).toBeCloseTo(0.01, 5);
  });

  it("is negative when the NAV-equivalent price is below the price-return price", () => {
    expect(adjustedSpread(99, 100)).toBeCloseTo(-0.01, 5);
  });
});
