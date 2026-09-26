import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluationsTag, ledgerShowingNote } from "../components/counters";
import { groupLedgerRows } from "../components/ledger-groups";
import type { AuditLedgerEntry } from "../components/api-types";

// On the live site after about an hour, the monitor's tag froze at
// "LIVE · 120 evaluations this session" and the ledger's grouped row at
// "300 entries" (2026-09-26): both routes cap what they return, and the
// labels counted what was returned. docs/how-to-use.md told judges to
// watch those numbers go up.

const ROOT = join(__dirname, "..");

function detectionEntry(i: number): AuditLedgerEntry {
  return {
    kind: "detection",
    id: `ledger_${i}`,
    timestamp: 1_790_000_000_000 + i * 30_000,
    mode: "simulation",
    outcome: "no_opportunity",
    detection: {
      ticker: "MSFT",
      cheapPool: { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 517.47 },
      expensivePool: { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: 517.6 },
      grossGap: 0.00025,
      netEdge: -0.0128,
      threshold: 0.0001,
      gas: { costUsd: 0.024, source: "live" },
      reference: { status: "ok", priceUsd: 518.8, vendor: "LiquidMesh", route: "Rfq Neptunex" },
      marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
    },
  } as unknown as AuditLedgerEntry;
}

afterEach(() => {
  vi.doUnmock("../lib/execution/audit-ledger");
  vi.doUnmock("../lib/orchestration/agent-loop");
  vi.resetModules();
});

async function withLedger(count: number) {
  vi.resetModules();
  const entries = Array.from({ length: count }, (_, i) => detectionEntry(i));
  vi.doMock("../lib/execution/audit-ledger", async (orig) => ({
    ...(await orig<typeof import("../lib/execution/audit-ledger")>()),
    defaultLedger: { readAll: () => entries },
  }));
  vi.doMock("../lib/orchestration/agent-loop", async (orig) => ({
    ...(await orig<typeof import("../lib/orchestration/agent-loop")>()),
    previewOpportunities: async () => ({ spreads: [], opportunities: [], warmUp: {} }),
  }));
}

// Re-importing a route module (next/server, viem) can take several
// seconds while the rest of the suite runs in parallel.
describe("the routes report the true totals, not just what they return", { timeout: 30_000 }, () => {
  it("/api/opportunities: 500 evaluations → chart gets 120 points, total says 500", async () => {
    await withLedger(500);
    const { GET } = await import("../app/api/opportunities/route");
    const body = await (await GET(new Request("http://localhost/api/opportunities"))).json();
    expect(body.history.MSFT.points).toHaveLength(120);
    expect(body.history.MSFT.total).toBe(500);
  });

  it("/api/ledger: 500 entries → 300 returned, total says 500", async () => {
    await withLedger(500);
    const { GET } = await import("../app/api/ledger/route");
    const body = await (await GET()).json();
    expect(body.entries).toHaveLength(300);
    expect(body.total).toBe(500);
  });
});

describe("labels keep increasing, and say honestly when a list is capped", () => {
  it("evaluations tag: the true count, plus how much the chart shows once capped", () => {
    expect(evaluationsTag(1, 1)).toBe("LIVE · 1 evaluation this session");
    expect(evaluationsTag(57, 57)).toBe("LIVE · 57 evaluations this session");
    expect(evaluationsTag(1234, 120)).toBe("LIVE · 1,234 evaluations this session · chart shows the last 120");
  });

  it("ledger note: only when capped", () => {
    expect(ledgerShowingNote(120, 120)).toBeNull();
    expect(ledgerShowingNote(1234, 300)).toBe("Showing the newest 300 of 1,234 entries.");
  });

  it("the oldest group is marked as cut off when the list is capped", () => {
    const shown = Array.from({ length: 300 }, (_, i) => detectionEntry(i));
    const groups = groupLedgerRows(shown, { truncated: true });
    const last = groups[groups.length - 1]!;
    expect(last.type === "detection" && last.continuesBeyondShown).toBe(true);
    const uncut = groupLedgerRows(shown, { truncated: false });
    const lastUncut = uncut[uncut.length - 1]!;
    expect(lastUncut.type === "detection" && lastUncut.continuesBeyondShown).toBe(false);
  });

  it("the panels use these labels", () => {
    const monitor = readFileSync(join(ROOT, "components/pool-spread-monitor.tsx"), "utf8");
    expect(monitor).toContain("evaluationsTag(");
    expect(monitor).not.toContain("evaluations this session`");
    const ledger = readFileSync(join(ROOT, "components/audit-ledger.tsx"), "utf8");
    expect(ledger).toContain("ledgerShowingNote(");
  });

  it("docs/how-to-use.md no longer promises a count that grows forever without mentioning the cap", () => {
    const doc = readFileSync(join(ROOT, "docs/how-to-use.md"), "utf8");
    expect(doc).not.toContain("N higher by about 2, and a new point on the chart.");
    expect(doc).toContain("chart shows the last 120");
    expect(doc).toContain("Showing the newest 300");
  });
});
