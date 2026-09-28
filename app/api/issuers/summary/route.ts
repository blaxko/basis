import { NextResponse } from "next/server";
import { defaultRecorder } from "../../../../lib/issuers/cross-issuer";
import { issuerPanelSummary } from "../../../../lib/issuers/panel-summary";
import { checkRateLimit, clientIp, ISSUERS_SUMMARY_RATE_LIMIT } from "../../../../lib/config/rate-limit";

// The issuer monitor panel's data: the latest cross-issuer reading, the last
// hour's figures and why any token is left out, from the recorder's memory.
// Never triggers a Binance call. Monitor only: Basis doesn't trade across
// issuers.
export async function GET(request: Request) {
  const limit = checkRateLimit(ISSUERS_SUMMARY_RATE_LIMIT, clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      { error: `rate limited (${limit.scope}); retry in ${limit.retryAfterSeconds}s` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  const recorder = defaultRecorder();
  return NextResponse.json(issuerPanelSummary(recorder.readings(), recorder.status().tokens, Date.now()));
}
