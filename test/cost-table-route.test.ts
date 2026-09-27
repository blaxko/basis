import { describe, it, expect, vi, afterEach } from "vitest";
import type { DetectionSnapshot } from "../lib/execution/audit-ledger";

// /api/opportunities serves the cost table for the same evaluation the
// monitor shows as "latest", so the table's net edge is the chart's.

function detection(cheap: number, dear: number, gas: number, netEdge: number): DetectionSnapshot {
  return {
    ticker: "MSFT",
    cheapPool: { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: cheap },
    expensivePool: { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: dear },
    grossGap: (dear - cheap) / cheap,
    netEdge,
    threshold: 0.0001,
    gas: { costUsd: gas, source: "live" },
    reference: { status: "ok", priceUsd: 519.1, vendor: "LiquidMesh", route: "x" },
    marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
  };
}

afterEach(() => {
  vi.doUnmock("../lib/execution/audit-ledger");
  vi.doUnmock("../lib/orchestration/agent-loop");
  vi.resetModules();
});

describe("/api/opportunities cost table", () => {
  it("is computed from the latest evaluation, and its net edge equals the latest chart point's", async () => {
    vi.resetModules();
    const real = await vi.importActual<typeof import("../lib/execution/audit-ledger")>("../lib/execution/audit-ledger");
    const ledger = new real.AuditLedger();
    // Net edges as the detector computed them (live readings, 2026-09-26).
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(518.75, 519.16, 0.0241, -0.01231) });
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(518.7520441736424, 519.1618644400467, 0.02414223869532307, -0.01230937778729475) });
    vi.doMock("../lib/execution/audit-ledger", async (orig) => ({ ...(await orig<typeof import("../lib/execution/audit-ledger")>()), defaultLedger: ledger }));
    vi.doMock("../lib/orchestration/agent-loop", async (orig) => ({
      ...(await orig<typeof import("../lib/orchestration/agent-loop")>()),
      previewOpportunities: async () => ({ spreads: [], opportunities: [], warmUp: {} }),
    }));
    const { GET } = await import("../app/api/opportunities/route");
    const body = await (await GET(new Request("http://localhost/api/opportunities"))).json();
    const series = body.history.MSFT;
    const last = series.points[series.points.length - 1];
    expect(series.costs.tradeSizeUsd).toBe(200);
    expect(series.costs.netEdge).toBeCloseTo(last.adjustedSpread, 12);
    expect(series.costs.grossGap).toBeCloseTo(last.rawSpread, 12);
    expect(series.costs.lines.find((l: { key: string }) => l.key === "gas").usd).toBeCloseTo(0.02414223869532307, 12);
    expect(series.costs.at).toBe(last.timestamp);
  });
});
