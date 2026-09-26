import { describe, it, expect, vi, afterEach } from "vitest";
import { AuditLedger, MAX_STORED_ENTRIES, type DetectionSnapshot } from "../lib/execution/audit-ledger";
import type { GuardrailVerdict } from "../lib/guardrails/check";

// The in-memory ledger used to keep one entry per 30 s tick forever:
// ~2,880 a day, ~60,000 over three weeks of judging, and /api/opportunities
// filtered all of them on every dashboard poll. Consecutive "no
// opportunity" detections are now compacted into one run entry at write
// time; everything else keeps full detail; totals stay exact.

const TICKS_PER_WEEK = 7 * 24 * 60 * 2; // every 30 s
const INSTRUCTION_EVERY_TICKS = 240; // one typed instruction every ~2 h

function detection(i: number): DetectionSnapshot {
  const wobble = ((i * 7919) % 100) / 1e6; // deterministic variation
  return {
    ticker: "MSFT",
    cheapPool: { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 518.75 + wobble },
    expensivePool: { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: 519.16 },
    grossGap: 0.0008 - wobble,
    netEdge: -0.0123 - wobble,
    threshold: 0.0001,
    gas: { costUsd: 0.024, source: i % 500 === 0 ? "fallback" : "live" },
    reference: i % 700 === 0 ? { status: "unavailable", reason: "Binance: timed out" } : { status: "ok", priceUsd: 519.1, vendor: "LiquidMesh", route: "Rfq Neptunex" },
    marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
  };
}

const verdict = { approved: true, status: "approved", reason: "all runnable guardrail checks passed", checks: [], timestamp: 0, input: { ticker: "MSFT", sizeUsd: 200, adjustedSpread: -0.0123 } } as unknown as GuardrailVerdict;

// Runs `ticks` scheduler ticks (plus the periodic instruction) on `ledger`.
function simulate(ledger: AuditLedger, fromTick: number, ticks: number): void {
  for (let i = fromTick; i < fromTick + ticks; i++) {
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(i) });
    if (i % INSTRUCTION_EVERY_TICKS === INSTRUCTION_EVERY_TICKS - 1) ledger.append({ mode: "simulation", outcome: "no_edge", verdict });
  }
}

const storedBytes = (ledger: AuditLedger) => JSON.stringify(ledger.readAll()).length;

afterEach(() => {
  vi.doUnmock("../lib/orchestration/agent-loop");
  vi.resetModules();
});

describe("three weeks of ticks: memory stays bounded, totals stay exact", { timeout: 120_000 }, () => {
  it("stored entries grow only with orders, never with ticks, and every tick is still counted", () => {
    const ledger = new AuditLedger();
    simulate(ledger, 0, TICKS_PER_WEEK);
    const week1 = { entries: ledger.readAll().length, bytes: storedBytes(ledger) };
    simulate(ledger, TICKS_PER_WEEK, 2 * TICKS_PER_WEEK);
    const week3 = { entries: ledger.readAll().length, bytes: storedBytes(ledger) };

    const instructions = Math.floor((3 * TICKS_PER_WEEK) / INSTRUCTION_EVERY_TICKS);
    // One run entry between each pair of instructions, plus the instructions.
    expect(week3.entries).toBeLessThanOrEqual(2 * instructions + 1);
    // Per-tick growth is zero: the bytes added in weeks 2–3 come from the
    // ~2 weeks of instructions (and the runs they split), not from 40,320 ticks.
    const bytesPerWeekOfTicks = (week3.bytes - week1.bytes) / 2;
    expect(bytesPerWeekOfTicks).toBeLessThan(week1.bytes * 1.2);
    expect(week3.bytes).toBeLessThan(2_000_000); // the old ledger: ~60,000 entries, well over 60 MB of JSON

    // Nothing is lost from the totals.
    expect(ledger.stats()).toMatchObject({ decisions: 3 * TICKS_PER_WEEK + instructions, droppedEntries: 0 });
    expect(ledger.evaluationCount("MSFT")).toBe(3 * TICKS_PER_WEEK);
    const runs = ledger.readAll().filter((e) => e.kind === "detection");
    expect(runs.reduce((n, e) => n + (e.kind === "detection" ? e.run?.count ?? 1 : 0), 0)).toBe(3 * TICKS_PER_WEEK);
  });

  it("a run keeps the latest full snapshot and the range of what it folded in", () => {
    const ledger = new AuditLedger();
    for (let i = 0; i < 5; i++) ledger.appendNoOpportunity({ mode: "simulation", detection: detection(i) });
    const [run] = ledger.readAll();
    if (run?.kind !== "detection") throw new Error("expected a detection run");
    expect(run.detection).toEqual(detection(4));
    expect(run.run).toMatchObject({ count: 5, netEdgeMin: Math.min(...[0, 1, 2, 3, 4].map((i) => detection(i).netEdge)), netEdgeMax: detection(0).netEdge });
    expect(run.run!.firstTimestamp).toBeLessThanOrEqual(run.timestamp);
  });

  it("anything that isn't a no-opportunity detection breaks the run and keeps full detail", () => {
    const ledger = new AuditLedger();
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(1) });
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(2) });
    ledger.append({ mode: "simulation", outcome: "no_edge", verdict });
    ledger.appendNoOpportunity({ mode: "dry-run", detection: detection(3) });
    ledger.appendNoOpportunity({ mode: "simulation", detection: detection(4) }); // mode change splits too
    ledger.appendWarmingUp({ mode: "simulation", detection: detection(5), warmUp: { readings: 3, required: 10 } });
    expect(ledger.readAll().map((e) => `${e.kind}:${e.outcome}:${e.kind === "detection" ? e.run?.count ?? 1 : "-"}`)).toEqual([
      "detection:no_opportunity:2",
      "pipeline:no_edge:-",
      "detection:no_opportunity:1",
      "detection:no_opportunity:1",
      "detection:warming_up:1",
    ]);
  });

  it("the chart keeps the last 120 evaluations per ticker, individually", () => {
    const ledger = new AuditLedger();
    for (let i = 0; i < 500; i++) ledger.appendNoOpportunity({ mode: "simulation", detection: detection(i) });
    const recent = ledger.recentEvaluations("MSFT");
    expect(recent).toHaveLength(120);
    expect(recent[119]!.detection).toEqual(detection(499));
    expect(ledger.evaluationCount("MSFT")).toBe(500);
  });

  it("a hard cap bounds stored entries even under abuse, and counts what was dropped", () => {
    const ledger = new AuditLedger();
    for (let i = 0; i < MAX_STORED_ENTRIES + 1000; i++) ledger.append({ mode: "simulation", outcome: "no_edge", verdict });
    expect(ledger.readAll()).toHaveLength(MAX_STORED_ENTRIES);
    expect(ledger.stats()).toMatchObject({ decisions: MAX_STORED_ENTRIES + 1000, storedEntries: MAX_STORED_ENTRIES, droppedEntries: 1000, droppedDecisions: 1000 });
  });

  it("dashboard routes answer as fast after three weeks as after one", async () => {
    vi.resetModules();
    vi.doMock("../lib/orchestration/agent-loop", async (orig) => ({
      ...(await orig<typeof import("../lib/orchestration/agent-loop")>()),
      previewOpportunities: async () => ({ spreads: [], opportunities: [], warmUp: {} }),
    }));
    const { defaultLedger } = await import("../lib/execution/audit-ledger");
    const opportunities = (await import("../app/api/opportunities/route")).GET;
    const ledgerRoute = (await import("../app/api/ledger/route")).GET;
    const time = async () => {
      const t0 = performance.now();
      for (let k = 0; k < 20; k++) {
        await (await opportunities(new Request("http://localhost/api/opportunities"))).json();
        await (await ledgerRoute()).json();
      }
      return (performance.now() - t0) / 20;
    };

    simulate(defaultLedger, 0, TICKS_PER_WEEK);
    await time(); // warm up JIT
    const week1 = await time();
    simulate(defaultLedger, TICKS_PER_WEEK, 2 * TICKS_PER_WEEK);
    const week3 = await time();
    const body = await (await opportunities(new Request("http://localhost/api/opportunities"))).json();

    console.log("ROUTE TIMING ms", week1.toFixed(2), week3.toFixed(2));
    expect(body.history.MSFT.total).toBe(3 * TICKS_PER_WEEK);
    expect(body.history.MSFT.points).toHaveLength(120);
    expect(week3).toBeLessThan(week1 * 2 + 5); // flat, with room for timer noise
  });
});
