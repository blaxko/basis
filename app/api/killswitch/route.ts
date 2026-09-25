import { NextResponse } from "next/server";
import { z } from "zod";
import { getKillswitchMode, setKillswitchMode } from "../../../lib/orchestration/killswitch";
import { ReadOnlyModeError } from "../../../lib/config/deployment";

const BodySchema = z.object({
  mode: z.enum(["simulation", "dry-run", "live"]),
});

export async function GET() {
  return NextResponse.json({ mode: getKillswitchMode() });
}

// The only path that can change the killswitch state — always an
// explicit call, never an implicit transition.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "body must be { mode: 'simulation' | 'dry-run' | 'live' }" }, { status: 400 });
  }

  try {
    setKillswitchMode(parsed.data.mode);
  } catch (err) {
    if (err instanceof ReadOnlyModeError) {
      return NextResponse.json({ error: err.message, mode: getKillswitchMode() }, { status: 403 });
    }
    throw err;
  }
  return NextResponse.json({ mode: getKillswitchMode() });
}
