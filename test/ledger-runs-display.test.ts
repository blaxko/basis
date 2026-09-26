import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeDetections, groupLedgerRows } from "../components/ledger-groups";
import type { AuditLedgerEntry, DetectionLedgerEntry } from "../components/api-types";

// With write-time compaction one stored detection entry can stand for many
// readings (entry.run). The panel's grouped row must count readings, not
// stored entries, and use the run's ranges.

function det(id: string, ts: number, netEdge: number, run?: DetectionLedgerEntry["run"]): DetectionLedgerEntry {
  return {
    kind: "detection",
    id,
    timestamp: ts,
    mode: "simulation",
    outcome: "no_opportunity",
    detection: {
      ticker: "MSFT",
      cheapPool: { address: "0xa", feeUnits: 2500, priceUsd: 518.75 },
      expensivePool: { address: "0xb", feeUnits: 10000, priceUsd: 519.16 },
      grossGap: 0.0008,
      netEdge,
      threshold: 0.0001,
      gas: { costUsd: 0.024, source: "live" },
      reference: { status: "ok", priceUsd: 519.1, vendor: "LiquidMesh", route: "x" },
      marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
    },
    ...(run ? { run } : {}),
  } as DetectionLedgerEntry;
}

describe("detection runs on the Audit Ledger panel", () => {
  it("counts every reading folded into a run, with the run's ranges and first time", () => {
    const run = { count: 55, firstTimestamp: 1_000, netEdgeMin: -0.0131, netEdgeMax: -0.0120, grossGapMin: 0.0001, grossGapMax: 0.0009, fallbackGas: 2, noReference: 1 };
    const newestFirst = [det("r", 60_000, -0.0123, run), det("s", 900, -0.0140)];
    expect(summarizeDetections(newestFirst)).toEqual({
      count: 56,
      firstTimestamp: 900,
      lastTimestamp: 60_000,
      netEdgeMin: -0.014,
      netEdgeMax: -0.012,
      fallbackGas: 2,
      noReference: 1,
    });
  });

  it("a single stored run entry is shown as a summary row, not a single reading", () => {
    const run = { count: 12, firstTimestamp: 1_000, netEdgeMin: -0.013, netEdgeMax: -0.012, grossGapMin: 0, grossGapMax: 0, fallbackGas: 0, noReference: 0 };
    const groups = groupLedgerRows([det("r", 5_000, -0.0123, run)] as AuditLedgerEntry[]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type === "detection" && summarizeDetections(groups[0]!.entries).count).toBe(12);
  });

  it("the panel renders runs through summarizeDetections", () => {
    const src = readFileSync(join(__dirname, "..", "components", "audit-ledger.tsx"), "utf8");
    expect(src).toContain("summarizeDetections(");
  });
});
