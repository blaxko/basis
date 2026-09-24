import { describe, it, expect } from "vitest";
import { priceSanityCheck, liquidityDepthCheck } from "./sanity-checks";

describe("priceSanityCheck", () => {
  it("accepts a price close to the recent median", () => {
    expect(priceSanityCheck(101, [98, 99, 100, 101, 102]).ok).toBe(true);
  });

  it("fails closed with no history, flagged as warming up", () => {
    const result = priceSanityCheck(420, []);
    expect(result.ok).toBe(false);
    expect(result.warmingUp).toBe(true);
    expect(result.reason).toContain("warming up: 0 of 1");
  });

  it("fails closed while history is shorter than the required minimum", () => {
    const result = priceSanityCheck(100, [99, 100, 101], 0.05, 10);
    expect(result.ok).toBe(false);
    expect(result.warmingUp).toBe(true);
    expect(result.reason).toContain("3 of 10");
  });

  it("passes once the minimum is met and the price is near the median", () => {
    const result = priceSanityCheck(100, Array.from({ length: 10 }, () => 100), 0.05, 10);
    expect(result.ok).toBe(true);
    expect(result.warmingUp).toBeUndefined();
  });

  it("rejects a non-positive price", () => {
    const result = priceSanityCheck(0, [100, 101]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects a price far outside recent history (corrupted feed)", () => {
    const result = priceSanityCheck(99999, [98, 99, 100, 101, 102]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe("liquidityDepthCheck", () => {
  it("accepts depth at or above the minimum", () => {
    expect(liquidityDepthCheck(5000, 1000).ok).toBe(true);
  });

  it("rejects thin liquidity below the minimum", () => {
    const result = liquidityDepthCheck(50, 1000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
