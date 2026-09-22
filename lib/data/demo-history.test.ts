import { describe, it, expect } from "vitest";
import { getDemoHistory } from "./demo-history";

describe("getDemoHistory — MSFT ex-div seeded series", () => {
  it("shows the raw spread spiking on the ex-div date while the adjusted spread stays flat", () => {
    const history = getDemoHistory("MSFT");
    expect(history.length).toBeGreaterThan(1);

    for (const point of history) {
      expect(Math.abs(point.adjustedSpread)).toBeLessThan(0.0005);
    }

    const exDivPoint = history.find((p) => p.date === "2025-08-21");
    expect(exDivPoint).toBeDefined();
    expect(exDivPoint!.rawSpread).toBeGreaterThan(0.0015);

    const priorPoint = history.find((p) => p.date === "2025-08-20");
    expect(priorPoint).toBeDefined();
    expect(Math.abs(priorPoint!.rawSpread)).toBeLessThan(0.0005);
  });

  it("returns an empty array for an underlying with no seeded history", () => {
    expect(getDemoHistory("AAPL")).toEqual([]);
  });
});
