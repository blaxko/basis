import { NextResponse } from "next/server";
import { z } from "zod";
import { isPublicReadOnly } from "../../../lib/config/deployment";

// The manual execution test, sending REAL transactions:
//   {"sizeUsd": <=5, "confirm": true}               round trip: buy MSFTB on
//                                                   the 0.25% pool, sell it back
//   {"action": "sell_only", "confirm": true}        recovery: sell the MSFTB the
//                                                   wallet holds (up to $5 worth)
// Only an explicit POST reaches it; the scheduler and the arbitrage path
// cannot. It still refuses unless
// the killswitch is "live" and the body carries confirm: true. The $5 cap
// is enforced in lib/execution/execution-test.ts, not only here.
//
// On a PUBLIC_READ_ONLY deployment it answers 403 before anything else,
// and the execution-test module (which imports the send path) is loaded
// only by the dynamic import below — never on a read-only server. Keep it
// that way: no static import of lib/execution/execution-test here.
const BodySchema = z.object({
  action: z.enum(["round_trip", "sell_only"]).optional(),
  sizeUsd: z.number().optional(),
  confirm: z.boolean(),
});

export async function POST(request: Request) {
  if (isPublicReadOnly()) {
    return NextResponse.json(
      { error: "PUBLIC_READ_ONLY: the execution test runs locally only, never on a public deployment." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body must be { sizeUsd: number (at most 5), confirm: true } or { action: "sell_only", confirm: true }' }, { status: 400 });
  }

  const [{ runExecutionTest }, { getKillswitchMode }, { defaultSpendTracker }] = await Promise.all([
    import("../../../lib/execution/execution-test"),
    import("../../../lib/orchestration/killswitch"),
    import("../../../lib/orchestration/spend-tracker"),
  ]);

  // Every outcome, refusals included, is one "execution_test" ledger entry.
  const entry = await runExecutionTest(parsed.data, { getKillswitchMode, spendTracker: defaultSpendTracker });
  return NextResponse.json(entry, { status: entry.outcome === "refused" ? 409 : 200 });
}
