// The Audit Ledger panel's filter and client-side CSV export. Pure: works
// on the rows the panel already shows; no request, nothing shared changes.
import { summarizeDetections, type LedgerRowGroup } from "./ledger-groups";
import { ledgerVerdictWord } from "./verdict-wording";

export type LedgerFilter = "all" | "orders" | "detections";

export function filterGroups(groups: readonly LedgerRowGroup[], filter: LedgerFilter): LedgerRowGroup[] {
  if (filter === "orders") return groups.filter((g) => g.type === "pipeline" || g.type === "execution_test");
  if (filter === "detections") return groups.filter((g) => g.type === "detection" || g.type === "scheduler");
  return [...groups];
}

const HEADER = ["first_utc", "last_utc", "kind", "outcome", "count", "ticker", "size_usd", "net_edge_min", "net_edge_max", "text"];

function field(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function groupsToCsv(groups: readonly LedgerRowGroup[]): string {
  const rows = groups.map((g) => {
    switch (g.type) {
      case "detection": {
        const s = summarizeDetections(g.entries);
        const latest = g.entries[0]!;
        return [iso(s.firstTimestamp), iso(s.lastTimestamp), "detection", latest.outcome, s.count, latest.detection.ticker, null, s.netEdgeMin, s.netEdgeMax, `detection: ${latest.outcome}`];
      }
      case "pipeline": {
        const e = g.entry;
        const i = e.verdict.input;
        return [iso(e.timestamp), iso(e.timestamp), "pipeline", e.outcome, 1, i.ticker, i.sizeUsd, i.adjustedSpread, i.adjustedSpread, `${ledgerVerdictWord(e.verdict, e.outcome)} (${e.verdict.reason})`];
      }
      case "execution_test": {
        const e = g.entry;
        return [iso(e.timestamp), iso(e.timestamp), "execution_test", e.outcome, 1, null, e.sizeUsd, null, null, `EXECUTION TEST (not arbitrage)${e.reason ? `: ${e.reason}` : ""}`];
      }
      case "scheduler": {
        const e = g.entry;
        return [iso(e.timestamp), iso(e.timestamp), "scheduler", e.outcome, 1, null, null, null, null, "tick skipped"];
      }
    }
  });
  return [HEADER, ...rows].map((r) => r.map(field).join(",")).join("\n") + "\n";
}
