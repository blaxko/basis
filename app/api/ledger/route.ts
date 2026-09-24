import { NextResponse } from "next/server";
import { defaultLedger } from "../../../lib/execution/audit-ledger";

// ~2.5 hours of scheduler ticks. The panel collapses runs of detection
// entries, so this mainly decides how far back a guardrail block stays
// reachable. The full ledger is never truncated — only this response.
const MAX_ENTRIES = 300;

export async function GET() {
  const entries = defaultLedger.readAll();
  const recent = entries.slice(Math.max(0, entries.length - MAX_ENTRIES)).reverse();
  return NextResponse.json({ entries: recent });
}
