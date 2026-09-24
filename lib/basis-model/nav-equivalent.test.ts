import { describe, it, expect } from "vitest";
import { feeAdjustedPrice } from "./nav-equivalent";

describe("feeAdjustedPrice", () => {
  it("increases the effective price when buying, by the pool's fee", () => {
    // Real 1% fee pool price for MSFTB this session: $496.98.
    expect(feeAdjustedPrice(496.98, 10000, "buy")).toBeCloseTo(496.98 * 1.01, 5);
  });

  it("decreases the effective price when selling, by the pool's fee", () => {
    // Real 0.25% fee pool price for MSFTB this session: $500.54.
    expect(feeAdjustedPrice(500.54, 2500, "sell")).toBeCloseTo(500.54 * 0.9975, 5);
  });

  it("returns the raw price unchanged for a zero-fee pool", () => {
    expect(feeAdjustedPrice(500, 0, "buy")).toBe(500);
    expect(feeAdjustedPrice(500, 0, "sell")).toBe(500);
  });
});
