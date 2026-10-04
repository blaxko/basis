import { NextResponse } from "next/server";
import { DEFAULT_AGENT_LOOP_CONFIG } from "../../../lib/orchestration/agent-loop";
import { defaultLedger } from "../../../lib/execution/audit-ledger";
import { costBreakdown } from "../../../lib/basis-model/cost-breakdown";
import type { LiveReading } from "../../../components/api-types";

// The live reading shown on the landing page and in the How it works
// example: the latest evaluation the scheduler already recorded (every
// 30 s), split into its costs with the Basis Model's own functions, the
// same as the dashboard's cost table. Only a memory read: no live pool
// read and no Binance call, so it needs no rate limit. The pages render it
// on the server (they call GET below in-process) and the landing page's
// browser refreshes it from here.

export const dynamic = "force-dynamic";

const feeLabel = (feeUnits: number) => `${feeUnits / 10_000}%`;

export async function GET(): Promise<Response> {
  const ticker = DEFAULT_AGENT_LOOP_CONFIG.underlyings[0];
  const evaluations = ticker ? defaultLedger.recentEvaluations(ticker) : [];
  const latest = evaluations[evaluations.length - 1];
  if (!latest) return NextResponse.json({ reading: null }, { headers: { "Cache-Control": "no-store" } });

  const d = latest.detection;
  const costs = costBreakdown({
    cheapPriceUsd: d.cheapPool.priceUsd,
    cheapFeeUnits: d.cheapPool.feeUnits,
    dearPriceUsd: d.expensivePool.priceUsd,
    dearFeeUnits: d.expensivePool.feeUnits,
    slippagePct: DEFAULT_AGENT_LOOP_CONFIG.slippagePctEstimate,
    gasCostUsd: d.gas.costUsd,
    tradeSizeUsd: DEFAULT_AGENT_LOOP_CONFIG.orderSizeUsd,
  });
  const pools = [d.cheapPool, d.expensivePool]
    .slice()
    .sort((a, b) => a.feeUnits - b.feeUnits)
    .map((p) => ({ fee: feeLabel(p.feeUnits), priceUsd: p.priceUsd }));
  const reading: LiveReading = {
    at: new Date(latest.timestamp).toISOString(),
    tradeSizeUsd: costs.tradeSizeUsd,
    pools,
    grossGap: costs.grossGap,
    totalCost: costs.totalCostPct,
    netEdge: costs.netEdge,
    lines: costs.lines.map(({ key, pct, usd, feeUnits }) => ({ key, pct, usd, ...(feeUnits !== undefined ? { feeUnits } : {}) })),
  };
  return NextResponse.json({ reading }, { headers: { "Cache-Control": "no-store" } });
}
