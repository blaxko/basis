import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterGroups, groupsToCsv, type LedgerFilter } from "../components/ledger-csv";
import { groupLedgerRows } from "../components/ledger-groups";
import type { AuditLedgerEntry } from "../components/api-types";

// The Audit Ledger panel's filter (All / Orders / Detections) and its
// client-side CSV export of the rows currently shown. Both work on the
// data the panel already has: no request, no shared state.

const det = (id: string, ts: number, net: number, count?: number) =>
  ({
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
      netEdge: net,
      threshold: 0.0001,
      gas: { costUsd: 0.024, source: "live" },
      reference: { status: "ok", priceUsd: 519.1, vendor: "LiquidMesh", route: "x" },
      marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
    },
    ...(count ? { run: { count, firstTimestamp: ts - 60_000, netEdgeMin: net, netEdgeMax: net, grossGapMin: 0, grossGapMax: 0, fallbackGas: 0, noReference: 0 } } : {}),
  }) as AuditLedgerEntry;

const order = (id: string, ts: number, outcome: string, approved: boolean, reason: string) =>
  ({ kind: "pipeline", id, timestamp: ts, mode: "simulation", outcome, verdict: { approved, status: approved ? "approved" : "blocked", reason, checks: [], timestamp: ts, input: { ticker: "MSFT", sizeUsd: 1000, adjustedSpread: -0.0123 } } }) as unknown as AuditLedgerEntry;

// newest first, as the route returns them
const entries = [det("d2", Date.parse("2026-09-26T18:05:00Z"), -0.0123, 11), order("o1", Date.parse("2026-09-26T18:00:43Z"), "blocked", false, 'order size $1000 exceeds per-trade cap $500, "hard"'), det("d1", Date.parse("2026-09-26T17:59:00Z"), -0.0124)];

describe("ledger filter", () => {
  const groups = groupLedgerRows(entries);
  it.each<[LedgerFilter, number]>([["all", 3], ["orders", 1], ["detections", 2]])("%s → %i rows", (f, n) => {
    expect(filterGroups(groups, f)).toHaveLength(n);
  });
});

describe("CSV export of the rows shown", () => {
  it("one row per shown group, with a header, counts and quoted text", () => {
    const csv = groupsToCsv(filterGroups(groupLedgerRows(entries), "all"));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("first_utc,last_utc,kind,outcome,count,ticker,size_usd,net_edge_min,net_edge_max,text");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("2026-09-26T18:04:00.000Z,2026-09-26T18:05:00.000Z,detection,no_opportunity,11,MSFT,,");
    expect(lines[2]).toContain(",pipeline,blocked,1,MSFT,1000,");
    // quotes in text are doubled, and the field is quoted
    expect(lines[2]).toContain('"BLOCKED (order size $1000 exceeds per-trade cap $500, ""hard"")"');
  });

  it("the panel offers All / Orders / Detections and Export CSV, and no control that changes shared state", () => {
    const src = readFileSync(join(__dirname, "..", "components", "audit-ledger.tsx"), "utf8");
    for (const s of ["filterGroups(", "groupsToCsv(", "Export CSV"]) expect(src).toContain(s);
    expect(src).not.toMatch(/fetch\([^)]*method:\s*["'](POST|DELETE|PUT)/);
    expect(src).not.toMatch(/Reset Session|reset/i);
  });
});
