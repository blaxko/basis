import { NextResponse } from "next/server";
import { defaultLedger } from "../../../lib/execution/audit-ledger";

const MAX_ENTRIES = 100;

export async function GET() {
  const entries = defaultLedger.readAll();
  const recent = entries.slice(Math.max(0, entries.length - MAX_ENTRIES)).reverse();
  return NextResponse.json({ entries: recent });
}
