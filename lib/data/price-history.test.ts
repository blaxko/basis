import { describe, it, expect, vi } from "vitest";
import { BoundedPriceHistory } from "./price-history";

describe("BoundedPriceHistory", () => {
  it("keeps readings per pool, oldest first, case-insensitive on address", () => {
    const history = new BoundedPriceHistory();
    history.record("0xAbC", 1);
    history.record("0xabc", 2);
    history.record("0xdef", 9);
    expect(history.recent("0xABC")).toEqual([1, 2]);
    expect(history.recent("0xdef")).toEqual([9]);
    expect(history.recent("0xnone")).toEqual([]);
  });

  it("drops the oldest readings past the bound", () => {
    const history = new BoundedPriceHistory(3);
    for (const p of [1, 2, 3, 4, 5]) history.record("0xabc", p);
    expect(history.recent("0xabc")).toEqual([3, 4, 5]);
  });

  it("returns a copy, so callers can't mutate stored history", () => {
    const history = new BoundedPriceHistory();
    history.record("0xabc", 1);
    history.recent("0xabc").push(999);
    expect(history.recent("0xabc")).toEqual([1]);
  });
});

describe("defaultPriceHistory — one per process, not one per bundle", () => {
  it("a reading recorded through one module instance is visible through another", async () => {
    vi.resetModules();
    const schedulerBundle = await import("./price-history");
    vi.resetModules();
    const routeBundle = await import("./price-history");
    expect(routeBundle).not.toBe(schedulerBundle);

    schedulerBundle.defaultPriceHistory.record("0xshared-test-pool", 497);
    expect(routeBundle.defaultPriceHistory.recent("0xshared-test-pool")).toEqual([497]);
  });
});
