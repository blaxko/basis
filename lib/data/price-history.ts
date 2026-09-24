// Recent live price readings per pool, for priceSanityCheck. Only the
// scheduler's evaluations record here (lib/orchestration/agent-loop.ts),
// never a GET route — so the warm-up after a server start is a fixed
// number of scheduler ticks, not something dashboard polling can speed up.
export interface PriceHistory {
  record(poolAddress: string, priceUsd: number): void;
  recent(poolAddress: string): number[];
}

export const DEFAULT_MAX_READINGS_PER_POOL = 60; // 30 minutes at the default 30s tick

export class BoundedPriceHistory implements PriceHistory {
  private readings = new Map<string, number[]>();

  constructor(private readonly maxPerPool = DEFAULT_MAX_READINGS_PER_POOL) {}

  record(poolAddress: string, priceUsd: number): void {
    const key = poolAddress.toLowerCase();
    const list = this.readings.get(key) ?? [];
    list.push(priceUsd);
    if (list.length > this.maxPerPool) list.splice(0, list.length - this.maxPerPool);
    this.readings.set(key, list);
  }

  recent(poolAddress: string): number[] {
    return [...(this.readings.get(poolAddress.toLowerCase()) ?? [])];
  }
}

// On globalThis for the same reason as defaultLedger: instrumentation.ts
// (the scheduler, which records) and the API routes (which read) are
// separate Next.js bundles. Tests construct their own instance.
const DEFAULT_PRICE_HISTORY_KEY = Symbol.for("basis.priceHistory.default");
export const defaultPriceHistory: PriceHistory = ((globalThis as unknown as Record<symbol, PriceHistory | undefined>)[
  DEFAULT_PRICE_HISTORY_KEY
] ??= new BoundedPriceHistory());
