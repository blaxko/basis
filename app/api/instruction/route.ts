import { NextResponse } from "next/server";
import { z } from "zod";
import { handleInstruction } from "../../../lib/orchestration/handle-instruction";
import { isPublicReadOnly } from "../../../lib/config/deployment";
import { checkRateLimit, clientIp, INSTRUCTION_RATE_LIMIT } from "../../../lib/config/rate-limit";

const BodySchema = z.object({
  instruction: z.string().min(1),
});

export async function POST(request: Request) {
  // Each request costs a Groq call and a Binance quote. Limited per IP on
  // a public (PUBLIC_READ_ONLY) deployment.
  if (isPublicReadOnly()) {
    const limit = checkRateLimit(INSTRUCTION_RATE_LIMIT, clientIp(request));
    if (!limit.ok) {
      return NextResponse.json(
        { error: `rate limited (${limit.scope}); retry in ${limit.retryAfterSeconds}s` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "body must be { instruction: string }" }, { status: 400 });
  }

  const result = await handleInstruction(parsed.data.instruction);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json(result);
}
