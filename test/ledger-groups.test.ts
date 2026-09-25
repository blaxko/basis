import { describe, it, expect } from "vitest";
import { groupLedgerRows } from "../components/ledger-groups";
import type { AuditLedgerEntry, DetectionLedgerEntry, PipelineLedgerEntry } from "../components/api-types";

let n = 0;
function detection(outcome: "no_opportunity" | "warming_up" = "no_opportunity", ticker = "MSFT"): DetectionLedgerEntry {
  n += 1;
  return {
    kind: "detection",
    id: `d${n}`,
    timestamp: n,
    mode: "simulation",
    outcome,
    detection: {
      ticker,
      cheapPool: { address: "0xa", feeUnits: 10000, priceUsd: 497 },
      expensivePool: { address: "0xb", feeUnits: 2500, priceUsd: 497.9 },
      grossGap: 0.0019,
      netEdge: -0.012 - n / 10_000,
      threshold: 0.0001,
      gas: { costUsd: 0.027, source: "live" },
      reference: { status: "ok", priceUsd: 498.8459, vendor: "LiquidMesh", route: "Rfq Neptunex" },
    },
  };
}

function pipeline(): PipelineLedgerEntry {
  n += 1;
  return { kind: "pipeline", id: `p${n}`, timestamp: n, mode: "simulation", outcome: "blocked" } as PipelineLedgerEntry;
}

describe("groupLedgerRows — display-only collapse of consecutive detection entries", () => {
  it("collapses a run of consecutive no_opportunity entries into one group", () => {
    const entries = [detection(), detection(), detection()];
    const groups = groupLedgerRows(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ type: "detection", entries });
  });

  it("never merges across a guardrail block, which stays its own visible row", () => {
    const entries: AuditLedgerEntry[] = [detection(), detection(), pipeline(), detection(), detection()];
    const groups = groupLedgerRows(entries);
    expect(groups.map((g) => (g.type === "detection" ? `detection×${g.entries.length}` : g.type))).toEqual([
      "detection×2",
      "pipeline",
      "detection×2",
    ]);
  });

  it("does not merge different outcomes or different tickers", () => {
    const groups = groupLedgerRows([detection("warming_up"), detection("no_opportunity"), detection("no_opportunity", "NVDA")]);
    expect(groups).toHaveLength(3);
  });

  it("drops nothing: every entry appears exactly once, in order", () => {
    const entries: AuditLedgerEntry[] = [detection(), pipeline(), detection(), detection("warming_up"), detection(), pipeline()];
    const flattened = groupLedgerRows(entries).flatMap((g): AuditLedgerEntry[] => (g.type === "detection" ? g.entries : [g.entry]));
    expect(flattened).toEqual(entries);
  });
});
