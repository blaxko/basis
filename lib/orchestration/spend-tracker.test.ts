import { describe, it, expect, vi } from "vitest";
import { DailySpendTracker } from "./spend-tracker";

describe("defaultSpendTracker — one daily cap per process, not one per bundle", () => {
  it("spend recorded through one module instance counts against the other", async () => {
    vi.resetModules();
    const schedulerBundle = await import("./spend-tracker");
    vi.resetModules();
    const routeBundle = await import("./spend-tracker");
    expect(routeBundle).not.toBe(schedulerBundle);

    const before = routeBundle.defaultSpendTracker.getSpentToday();
    schedulerBundle.defaultSpendTracker.recordSpend(200);
    expect(routeBundle.defaultSpendTracker.getSpentToday()).toBe(before + 200);
  });
});

describe("DailySpendTracker", () => {
  it("accumulates spend across multiple calls within the same UTC day", () => {
    const fixed = Date.UTC(2025, 7, 20, 10, 0, 0); // 2025-08-20 10:00 UTC
    const tracker = new DailySpendTracker(() => fixed);

    expect(tracker.getSpentToday()).toBe(0);
    tracker.recordSpend(200);
    tracker.recordSpend(150);
    expect(tracker.getSpentToday()).toBe(350);
  });

  it("resets at the UTC day boundary without waiting for real time to pass", () => {
    let current = Date.UTC(2025, 7, 20, 23, 59, 0); // 2025-08-20 23:59 UTC
    const tracker = new DailySpendTracker(() => current);

    tracker.recordSpend(400);
    expect(tracker.getSpentToday()).toBe(400);

    current = Date.UTC(2025, 7, 21, 0, 1, 0); // 2025-08-21 00:01 UTC — crossed midnight
    expect(tracker.getSpentToday()).toBe(0);

    tracker.recordSpend(75);
    expect(tracker.getSpentToday()).toBe(75);
  });

  it("keeps separate totals per UTC day rather than a single running total", () => {
    let current = Date.UTC(2025, 7, 20, 12, 0, 0);
    const tracker = new DailySpendTracker(() => current);

    tracker.recordSpend(500);
    current = Date.UTC(2025, 7, 21, 12, 0, 0);
    tracker.recordSpend(10);
    current = Date.UTC(2025, 7, 20, 18, 0, 0); // back to the 20th
    expect(tracker.getSpentToday()).toBe(500);
  });
});
