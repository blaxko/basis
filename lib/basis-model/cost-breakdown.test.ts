import { describe, it, expect } from "vitest";
import { costBreakdown } from "./cost-breakdown";
import { feeAdjustedPrice } from "./nav-equivalent";
import { adjustedSpread, rawSpread } from "./adjusted-spread";
import { computeSpreads } from "../orchestration/agent-loop";
import type { PoolQuote } from "../data/types";

// The redesign's cost table must add up to exactly the net edge the rest of
// the dashboard shows, so it's computed with the Basis Model's own functions.

// Real reading, live site 2026-09-26 18:27:49 UTC.
const LIVE = { cheapPriceUsd: 518.7520441736424, cheapFeeUnits: 2500, dearPriceUsd: 519.1618644400467, dearFeeUnits: 10000, slippagePct: 0.0005, gasCostUsd: 0.02414223869532307, tradeSizeUsd: 200 };

describe("costBreakdown", () => {
  it("its lines add up exactly to the Basis Model's net edge", () => {
    const c = costBreakdown(LIVE);
    const modelNet = adjustedSpread({
      effectiveBuyPriceUsd: feeAdjustedPrice(LIVE.cheapPriceUsd, LIVE.cheapFeeUnits, "buy"),
      effectiveSellPriceUsd: feeAdjustedPrice(LIVE.dearPriceUsd, LIVE.dearFeeUnits, "sell"),
      slippagePct: LIVE.slippagePct,
      gasCostUsd: LIVE.gasCostUsd,
      tradeSizeUsd: LIVE.tradeSizeUsd,
    });
    expect(c.netEdge).toBe(modelNet);
    expect(c.grossGap).toBe(rawSpread(LIVE.cheapPriceUsd, LIVE.dearPriceUsd));
    const sum = c.grossGap + c.lines.reduce((a, l) => a + l.pct, 0);
    expect(Math.abs(sum - c.netEdge)).toBeLessThan(1e-12);
    expect(Math.abs(c.totalCostPct - c.lines.reduce((a, l) => a + l.pct, 0))).toBeLessThan(1e-15);
    // The recorded net edge on the live site at that moment:
    expect(c.netEdge).toBeCloseTo(-0.01230937778729475, 12);
  });

  it("names each cost with its real value, in % and $ on the order", () => {
    const c = costBreakdown(LIVE);
    expect(c.lines.map((l) => l.key)).toEqual(["buyFee", "sellFee", "slippage", "gas"]);
    const gas = c.lines.find((l) => l.key === "gas")!;
    expect(gas.usd).toBeCloseTo(LIVE.gasCostUsd, 12);
    expect(gas.pct).toBeCloseTo(-LIVE.gasCostUsd / 200, 12);
    const slip = c.lines.find((l) => l.key === "slippage")!;
    expect(slip.pct).toBe(-0.0005);
    expect(slip.usd).toBeCloseTo(0.1, 12);
    expect(c.lines.find((l) => l.key === "buyFee")!.feeUnits).toBe(2500);
    expect(c.lines.find((l) => l.key === "sellFee")!.feeUnits).toBe(10000);
    for (const l of c.lines) expect(l.pct).toBeLessThan(0);
  });

  it("equals computeSpreads() for the same pools, gas and size", async () => {
    const quotes: PoolQuote[] = [
      { ticker: "MSFT", poolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: LIVE.cheapPriceUsd, liquidityUsdEstimate: 1e5, timestamp: 0 },
      { ticker: "MSFT", poolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: LIVE.dearPriceUsd, liquidityUsdEstimate: 1e5, timestamp: 0 },
    ];
    const [spread] = await computeSpreads({
      underlyings: ["MSFT"],
      fetchPoolQuotesFn: async () => quotes,
      estimateGasFn: async () => ({ gasCostUsd: LIVE.gasCostUsd, source: "live" }),
      slippagePctEstimate: LIVE.slippagePct,
      tradeSizeUsd: 200,
    });
    expect(costBreakdown(LIVE).netEdge).toBe(spread!.adjustedSpread);
  });
});
