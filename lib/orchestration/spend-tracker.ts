// Produces the "spend so far today" number Phase 2/3 injected as
// spentTodaySoFarUsd. Keyed by UTC calendar date specifically — the
// hackathon's own deadline convention is UTC, and it avoids timezone
// ambiguity during the demo.
export interface SpendTracker {
  recordSpend(amountUsd: number): void;
  getSpentToday(): number;
}

function utcDateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC
}

// In-memory, keyed by UTC date. "Reset at UTC midnight" isn't an
// explicit action here — a new UTC day is simply a key this map hasn't
// seen yet, so getSpentToday() naturally reads 0 once the clock crosses
// midnight UTC. `now` is injectable so tests can cross that boundary
// without waiting for it.
export class DailySpendTracker implements SpendTracker {
  private spendByDay = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  recordSpend(amountUsd: number): void {
    const key = utcDateKey(this.now());
    this.spendByDay.set(key, (this.spendByDay.get(key) ?? 0) + amountUsd);
  }

  getSpentToday(): number {
    const key = utcDateKey(this.now());
    return this.spendByDay.get(key) ?? 0;
  }
}

// Shared singleton for the real API routes / agent loop within one
// server process. Tests always construct their own DailySpendTracker
// instance instead, for isolation.
export const defaultSpendTracker: SpendTracker = new DailySpendTracker();
