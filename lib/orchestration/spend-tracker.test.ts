import { describe, it, expect } from "vitest";
import { DailySpendTracker } from "./spend-tracker";

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
