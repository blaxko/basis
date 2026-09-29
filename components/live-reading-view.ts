import type { OpportunitiesResponse } from "./api-types";

// What the landing page's live reading shows, from /api/opportunities: the
// latest live evaluation's two pool prices (by fee), gross gap, total costs
// and net edge. Anything else — a failed call, no live evaluation yet, the
// historical fixture — is "unavailable", with no number at all.
export type LiveReadingView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ok";
      at: string;
      tradeSizeUsd: number;
      pools: Array<{ fee: string; priceUsd: number }>;
      grossGap: number;
      totalCost: number;
      netEdge: number;
    };

const feeLabel = (feeUnits: number) => `${feeUnits / 10_000}%`;

export function liveReadingView(data: OpportunitiesResponse | null, error: string | null): LiveReadingView {
  if (error) return { kind: "unavailable" };
  if (!data) return { kind: "loading" };
  const series = Object.values(data.history ?? {})[0];
  const latest = series?.points[series.points.length - 1];
  if (!series || series.source !== "live" || !series.costs || !latest) return { kind: "unavailable" };
  const pools = [
    { feeUnits: latest.cheapPoolFeeUnits, priceUsd: latest.cheapPoolPriceUsd },
    { feeUnits: latest.expensivePoolFeeUnits, priceUsd: latest.expensivePoolPriceUsd },
  ]
    .sort((a, b) => a.feeUnits - b.feeUnits)
    .map((p) => ({ fee: feeLabel(p.feeUnits), priceUsd: p.priceUsd }));
  return {
    kind: "ok",
    at: series.costs.at,
    tradeSizeUsd: series.costs.tradeSizeUsd,
    pools,
    grossGap: series.costs.grossGap,
    totalCost: series.costs.totalCostPct,
    netEdge: series.costs.netEdge,
  };
}
