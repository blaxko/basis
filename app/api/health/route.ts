import { NextResponse } from "next/server";

// Deploy healthcheck (Railway queries it until it returns 2xx before
// switching traffic to a new deployment). Deliberately does no I/O — no
// RPC, no Binance — so a slow upstream can't fail a deploy. Whether the
// app's upstreams are healthy is what /api/status is for.
export async function GET() {
  return NextResponse.json({ ok: true });
}
