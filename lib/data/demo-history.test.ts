import { describe, it, expect } from "vitest";
import { getDemoHistory } from "./demo-history";

describe("getDemoHistory — real matched-timestamp MSFTB cross-pool series", () => {
  it("returns all 7 real hourly points gathered this session", () => {
    const history = getDemoHistory("MSFT");
    expect(history).toHaveLength(7);
  });

  it("which pool is cheaper genuinely flips across points, not curated to always favor one pool", () => {
    // rawSpread itself is always >= 0 by construction (cheap vs. expensive
    // are assigned per point) — what varies in the real data is WHICH
    // pool ends up cheaper each hour, reflected in cheapPoolFeeUnits.
    const history = getDemoHistory("MSFT");
    const cheapFeeTiers = new Set(history.map((p) => p.cheapPoolFeeUnits));
    expect(cheapFeeTiers.size).toBe(2); // both the 0.25% and 1% pools were cheaper at some point
  });

  it("the raw spread magnitude varies meaningfully across points, not a flat line", () => {
    const history = getDemoHistory("MSFT");
    const spreads = history.map((p) => p.rawSpread);
    expect(Math.max(...spreads) - Math.min(...spreads)).toBeGreaterThan(0.01);
  });

  it("every point's adjusted spread accounts for real fee tiers (0.25% and 1%), never both sides at 0", () => {
    const history = getDemoHistory("MSFT");
    for (const point of history) {
      expect([2500, 10000]).toContain(point.cheapPoolFeeUnits);
      expect([2500, 10000]).toContain(point.expensivePoolFeeUnits);
      expect(point.cheapPoolFeeUnits).not.toBe(point.expensivePoolFeeUnits);
    }
  });

  it("the cheap pool's price is always at or below the expensive pool's price, by construction", () => {
    const history = getDemoHistory("MSFT");
    for (const point of history) {
      expect(point.cheapPoolPriceUsd).toBeLessThanOrEqual(point.expensivePoolPriceUsd);
    }
  });

  it("includes the largest real gap found this session (2026-09-18T04:00Z, ~1.5% raw)", () => {
    const history = getDemoHistory("MSFT");
    const point = history.find((p) => p.timestamp === "2026-09-18T04:00:00Z");
    expect(point).toBeDefined();
    expect(point!.rawSpread).toBeGreaterThan(0.014);
  });

  it("returns an empty array for an underlying with no seeded history", () => {
    expect(getDemoHistory("AAPL")).toEqual([]);
  });
});
