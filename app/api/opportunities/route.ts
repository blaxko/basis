import { NextResponse } from "next/server";
import { computeSpreads } from "../../../lib/orchestration/agent-loop";

// Read-only by construction: this calls computeSpreads() only (Basis
// Model output), never runAgentLoop() — a GET request must never be
// able to trigger a guardrail/pipeline run or move money.
export async function GET() {
  try {
    const spreads = await computeSpreads();
    return NextResponse.json({ spreads });
  } catch (err) {
    // Never echo the raw error (it can originate from lib/data/quotes.ts,
    // which throws NotImplemented including instructions that mention
    // env var names — but never their values) — message text is safe to
    // surface, the underlying error object is not.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to compute spreads" },
      { status: 503 }
    );
  }
}
