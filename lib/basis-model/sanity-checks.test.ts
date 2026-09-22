import { describe, it, expect } from "vitest";
import { priceSanityCheck, liquidityDepthCheck } from "./sanity-checks";

describe("priceSanityCheck", () => {
  it("accepts a price close to the recent median", () => {
    expect(priceSanityCheck(101, [98, 99, 100, 101, 102]).ok).toBe(true);
  });

  it("accepts any positive price when there's no history yet", () => {
    expect(priceSanityCheck(420, []).ok).toBe(true);
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
