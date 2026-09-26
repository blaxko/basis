import { NextResponse } from "next/server";
import { defaultLedger } from "../../../lib/execution/audit-ledger";

// The newest 300 stored entries. Runs of "no opportunity" detections are
// already compacted into one entry each (lib/execution/audit-ledger.ts),
// so this reaches back across many hours of ticks and every order in
// between. What the ledger keeps, and drops only under abuse, is
// described there.
const MAX_ENTRIES = 300;

export async function GET() {
  const entries = defaultLedger.readAll();
  const recent = entries.slice(Math.max(0, entries.length - MAX_ENTRIES)).reverse();
  const stats = defaultLedger.stats();
  // `total` (stored entries) lets the panel say when it isn't showing
  // everything; `decisions` counts every decision, compacted or not.
  return NextResponse.json({
    entries: recent,
    total: stats.storedEntries,
    decisions: stats.decisions,
    dropped: { entries: stats.droppedEntries, decisions: stats.droppedDecisions },
  });
}
