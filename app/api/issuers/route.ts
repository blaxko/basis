import { NextResponse } from "next/server";
import { defaultRecorder } from "../../../lib/issuers/cross-issuer";
import { checkRateLimit, clientIp, ISSUERS_RATE_LIMIT } from "../../../lib/config/rate-limit";

// Read-only: what the cross-issuer recorder has recorded this session
// (bStocks MSFTB vs xStocks MSFTx vs Ondo MSFTon, per share), from memory.
// Never triggers a Binance call. Monitor only: Basis doesn't trade across
// issuers.
export async function GET(request: Request) {
  const limit = checkRateLimit(ISSUERS_RATE_LIMIT, clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      { error: `rate limited (${limit.scope}); retry in ${limit.retryAfterSeconds}s` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  const recorder = defaultRecorder();
  return NextResponse.json({ ...recorder.status(), readings: recorder.readings() });
}
