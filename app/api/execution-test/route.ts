import { NextResponse } from "next/server";
import { z } from "zod";
import { runExecutionTest, EXECUTION_TEST_HARD_CAP_USD_PER_LEG } from "../../../lib/execution/execution-test";
import { getKillswitchMode } from "../../../lib/orchestration/killswitch";
import { defaultSpendTracker } from "../../../lib/orchestration/spend-tracker";

// The manual execution test: buys up to $5 of MSFTB on the 0.25% pool and
// sells it back, sending REAL transactions. Only an explicit POST reaches
// it; the scheduler and the arbitrage path cannot. It still refuses unless
// the killswitch is "live" and the body carries confirm: true. The $5 cap
// is enforced in lib/execution/execution-test.ts, not only here.
const BodySchema = z.object({
  sizeUsd: z.number(),
  confirm: z.boolean(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `body must be { sizeUsd: number (at most ${EXECUTION_TEST_HARD_CAP_USD_PER_LEG}), confirm: true }` },
      { status: 400 }
    );
  }

  // Every outcome, refusals included, is one "execution_test" ledger entry.
  const entry = await runExecutionTest(parsed.data, { getKillswitchMode, spendTracker: defaultSpendTracker });
  return NextResponse.json(entry, { status: entry.outcome === "refused" ? 409 : 200 });
}
