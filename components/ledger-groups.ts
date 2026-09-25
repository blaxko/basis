import type { AuditLedgerEntry, DetectionLedgerEntry, ExecutionTestLedgerEntry, PipelineLedgerEntry, SchedulerLedgerEntry } from "./api-types";

export type LedgerRowGroup =
  | { type: "pipeline"; entry: PipelineLedgerEntry }
  | { type: "execution_test"; entry: ExecutionTestLedgerEntry }
  | { type: "scheduler"; entry: SchedulerLedgerEntry }
  | { type: "detection"; entries: DetectionLedgerEntry[] };

// Display-only: collapses runs of consecutive detection entries for the
// same ticker and outcome into one group, so a guardrail block isn't
// buried under a detection row every 30s. Every input entry appears in
// exactly one group, in the original order; nothing is dropped or merged
// across a pipeline or execution-test entry.
export function groupLedgerRows(entries: readonly AuditLedgerEntry[]): LedgerRowGroup[] {
  const groups: LedgerRowGroup[] = [];
  for (const entry of entries) {
    if (entry.kind === "pipeline") {
      groups.push({ type: "pipeline", entry });
      continue;
    }
    if (entry.kind === "execution_test") {
      groups.push({ type: "execution_test", entry });
      continue;
    }
    if (entry.kind === "scheduler") {
      groups.push({ type: "scheduler", entry });
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
