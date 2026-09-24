import type { AuditLedgerEntry, DetectionLedgerEntry, PipelineLedgerEntry } from "./api-types";

export type LedgerRowGroup =
  | { type: "pipeline"; entry: PipelineLedgerEntry }
  | { type: "detection"; entries: DetectionLedgerEntry[] };

// Display-only: collapses runs of consecutive detection entries for the
// same ticker and outcome into one group, so a guardrail block isn't
// buried under a detection row every 30s. Every input entry appears in
// exactly one group, in the original order; nothing is dropped or merged
// across a pipeline entry.
export function groupLedgerRows(entries: readonly AuditLedgerEntry[]): LedgerRowGroup[] {
  const groups: LedgerRowGroup[] = [];
  for (const entry of entries) {
    if (entry.kind === "pipeline") {
      groups.push({ type: "pipeline", entry });
      continue;
    }
    const last = groups[groups.length - 1];
    const sameRun =
      last?.type === "detection" &&
      last.entries[0]!.outcome === entry.outcome &&
      last.entries[0]!.detection.ticker === entry.detection.ticker;
    if (sameRun) {
      last.entries.push(entry);
    } else {
      groups.push({ type: "detection", entries: [entry] });
    }
  }
  return groups;
}
