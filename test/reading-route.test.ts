import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectionSnapshot } from "../lib/execution/audit-ledger";

// /api/reading: the landing page's live reading, server-rendered and then
// refreshed in the browser. Only the latest evaluation the scheduler
// already recorded: no live pool read, no Binance call, so it can serve
// every visitor without a rate limit.

function detection(cheap: number, cheapFee: number, dear: number, dearFee: number, gas: number, netEdge: number): DetectionSnapshot {
  return {
    ticker: "MSFT",
    cheapPool: { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: cheapFee, priceUsd: cheap },
    expensivePool: { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: dearFee, priceUsd: dear },
    grossGap: (dear - cheap) / cheap,
    netEdge,
    threshold: 0.0001,
    gas: { costUsd: gas, source: "live" },
    reference: { status: "ok", priceUsd: 512.04, vendor: "LiquidMesh", route: "x" },
    marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
  };
}

afterEach(() => {
  vi.doUnmock("../lib/execution/audit-ledger");
  vi.resetModules();
});

describe("/api/reading", () => {
  it("returns the latest recorded evaluation: both pools by fee, gross gap, total costs and net edge, with its time", async () => {
    vi.resetModules();
    const real = await vi.importActual<typeof import("../lib/execution/audit-ledger")>("../lib/execution/audit-ledger");
    const ledger = new real.AuditLedger();
    // A real reading, 2026-09-28 22:56:37 UTC (the 1% pool was cheaper).
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(509.0837624859116, 10000, 510.7387114316477, 2500, 0.023684511945710383, -0.009784055122455015) });
    vi.doMock("../lib/execution/audit-ledger", async (orig) => ({ ...(await orig<typeof import("../lib/execution/audit-ledger")>()), defaultLedger: ledger }));
    const { GET } = await import("../app/api/reading/route");
    const body = await (await GET()).json();
    expect(body.reading.pools).toEqual([
      { fee: "0.25%", priceUsd: 510.7387114316477 },
      { fee: "1%", priceUsd: 509.0837624859116 },
    ]);
    expect(body.reading.grossGap).toBeCloseTo(0.0032508382071641216, 12);
    expect(body.reading.netEdge).toBeCloseTo(-0.009784055122455015, 6);
    expect(body.reading.totalCost).toBeCloseTo(body.reading.netEdge - body.reading.grossGap, 12);
    expect(body.reading.tradeSizeUsd).toBe(200);
    expect(Date.parse(body.reading.at)).toBeGreaterThan(0);
  });

  it("no evaluation yet: null, never a made-up number", async () => {
    vi.resetModules();
    const real = await vi.importActual<typeof import("../lib/execution/audit-ledger")>("../lib/execution/audit-ledger");
    vi.doMock("../lib/execution/audit-ledger", async (orig) => ({ ...(await orig<typeof import("../lib/execution/audit-ledger")>()), defaultLedger: new real.AuditLedger() }));
    const { GET } = await import("../app/api/reading/route");
    expect(await (await GET()).json()).toEqual({ reading: null });
  });

  it("makes no network call: it only reads the ledger", () => {
    const src = readFileSync(join(__dirname, "..", "app", "api", "reading", "route.ts"), "utf8");
    const code = src.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/previewOpportunities|fetch\(|binance|rate-limit/i);
  });
});
