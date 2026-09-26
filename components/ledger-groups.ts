import type { AuditLedgerEntry, DetectionLedgerEntry, ExecutionTestLedgerEntry, PipelineLedgerEntry, SchedulerLedgerEntry } from "./api-types";

export type LedgerRowGroup =
  | { type: "pipeline"; entry: PipelineLedgerEntry }
  | { type: "execution_test"; entry: ExecutionTestLedgerEntry }
  | { type: "scheduler"; entry: SchedulerLedgerEntry }
  // continuesBeyondShown: the oldest group of a capped list, whose run of
  // detections goes on past what the response included.
  | { type: "detection"; entries: DetectionLedgerEntry[]; continuesBeyondShown: boolean };

// Display-only: collapses runs of consecutive detection entries for the
// same ticker and outcome into one group, so a guardrail block isn't
// buried under a detection row every 30s. Every input entry appears in
// exactly one group, in the original order; nothing is dropped or merged
// across a pipeline or execution-test entry.
// One grouped detection row's figures, counting every reading folded
// into a compacted run (entry.run), not just stored entries. `entries`
// is newest first, like the panel.
export interface DetectionSummary {
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
  netEdgeMin: number;
  netEdgeMax: number;
  fallbackGas: number;
  noReference: number;
}

export function summarizeDetections(entries: readonly DetectionLedgerEntry[]): DetectionSummary {
  const s: DetectionSummary = {
    count: 0,
    firstTimestamp: Infinity,
    lastTimestamp: -Infinity,
    netEdgeMin: Infinity,
    netEdgeMax: -Infinity,
    fallbackGas: 0,
    noReference: 0,
  };
  for (const e of entries) {
    const d = e.detection;
    const r = e.run;
    s.count += r?.count ?? 1;
    s.firstTimestamp = Math.min(s.firstTimestamp, r?.firstTimestamp ?? e.timestamp);
    s.lastTimestamp = Math.max(s.lastTimestamp, e.timestamp);
    s.netEdgeMin = Math.min(s.netEdgeMin, r?.netEdgeMin ?? d.netEdge);
    s.netEdgeMax = Math.max(s.netEdgeMax, r?.netEdgeMax ?? d.netEdge);
    s.fallbackGas += r ? r.fallbackGas : d.gas.source === "fallback" ? 1 : 0;
    s.noReference += r ? r.noReference : d.reference.status === "ok" ? 0 : 1;
  }
  return s;
}

export function groupLedgerRows(entries: readonly AuditLedgerEntry[], options: { truncated?: boolean } = {}): LedgerRowGroup[] {
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
      groups.push({ type: "detection", entries: [entry], continuesBeyondShown: false });
    }
  }
  const oldest = groups[groups.length - 1];
  if (options.truncated && oldest?.type === "detection") oldest.continuesBeyondShown = true;
  return groups;
}
