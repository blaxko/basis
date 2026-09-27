import { NextResponse } from "next/server";
import { previewOpportunities, DEFAULT_AGENT_LOOP_CONFIG } from "../../../lib/orchestration/agent-loop";
import { getDemoHistory, type SpreadHistoryPoint } from "../../../lib/data/demo-history";
import { defaultLedger, type EvaluationPoint } from "../../../lib/execution/audit-ledger";
import { costBreakdown, type CostBreakdown } from "../../../lib/basis-model/cost-breakdown";
import { isPublicReadOnly } from "../../../lib/config/deployment";
import { checkRateLimit, clientIp, OPPORTUNITIES_RATE_LIMIT } from "../../../lib/config/rate-limit";
import { logServerError, plainNetworkReason } from "../../../lib/errors/public-error";

// About an hour of scheduler ticks at the default 30s interval.
const MAX_LIVE_POINTS = 120;

// Three dashboard panels poll this route every 10–15s, and each live
// preview is ~12 RPC reads. Without sharing, a public RPC starts timing
// out (observed in testing) and every panel stalls. Concurrent polls
// share one in-flight read, and a result is reused for 10s. Failures are
// never cached.
const PREVIEW_TTL_MS = 10_000;
type Preview = Awaited<ReturnType<typeof previewOpportunities>>;
let cachedPreview: { at: number; value: Preview } | null = null;
let inflightPreview: Promise<Preview> | null = null;

function getPreview(): Promise<Preview> {
  if (cachedPreview && Date.now() - cachedPreview.at < PREVIEW_TTL_MS) {
    return Promise.resolve(cachedPreview.value);
  }
  inflightPreview ??= previewOpportunities()
    .then((value) => {
      cachedPreview = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflightPreview = null;
    });
  return inflightPreview;
}

// Read-only by construction: previewOpportunities() calls check() (pure)
// for a live-accurate verdict, but never runPipeline(), and reading the
// ledger never writes to it — a GET must never trigger a pipeline run.
//
// `history` per ticker is either:
//   - "live": every automatic evaluation the scheduler recorded in the
//     audit ledger this server session, so each chart point matches a
//     ledger row; or
//   - "historical": the seeded fixture in lib/data/demo-history.ts
//     (dated 2026-09-18 → 09-21), used only when no live evaluation
//     exists yet, e.g. BSC_RPC_URL isn't configured.
export async function GET(request: Request) {
  // The live preview fetches a Binance quote (through the 10 s cache
  // above). Limited per IP on a public (PUBLIC_READ_ONLY) deployment.
  if (isPublicReadOnly()) {
    const limit = checkRateLimit(OPPORTUNITIES_RATE_LIMIT, clientIp(request));
    if (!limit.ok) {
      return NextResponse.json(
        { error: `rate limited (${limit.scope}); retry in ${limit.retryAfterSeconds}s` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }
  }

  // `total` is every live evaluation this session; `points` is capped at
  // MAX_LIVE_POINTS, so the dashboard can say how much the chart shows.
  // Both come from the ledger's running count and per-ticker buffer, so a
  // poll costs the same after three weeks as after one minute.
  // `costs` breaks the latest live evaluation's net edge into its costs,
  // with the Basis Model's own functions (lib/basis-model/cost-breakdown.ts),
  // so the table's total is exactly the net edge the monitor shows.
  const history: Record<
    string,
    { source: "live" | "historical"; points: SpreadHistoryPoint[]; total: number; costs?: CostBreakdown & { at: string } }
  > = {};

  for (const ticker of DEFAULT_AGENT_LOOP_CONFIG.underlyings) {
    const evaluations = defaultLedger.recentEvaluations(ticker);
    const live = evaluations.slice(-MAX_LIVE_POINTS).map(toHistoryPoint);
    if (live.length > 0) {
      const latest = evaluations[evaluations.length - 1]!;
      const d = latest.detection;
      const costs = costBreakdown({
        cheapPriceUsd: d.cheapPool.priceUsd,
        cheapFeeUnits: d.cheapPool.feeUnits,
        dearPriceUsd: d.expensivePool.priceUsd,
        dearFeeUnits: d.expensivePool.feeUnits,
        slippagePct: DEFAULT_AGENT_LOOP_CONFIG.slippagePctEstimate,
        gasCostUsd: d.gas.costUsd,
        tradeSizeUsd: DEFAULT_AGENT_LOOP_CONFIG.orderSizeUsd,
      });
      history[ticker] = {
        source: "live",
        points: live,
        total: defaultLedger.evaluationCount(ticker),
        costs: { ...costs, at: new Date(latest.timestamp).toISOString() },
      };
    } else {
      const fixture = getDemoHistory(ticker);
      history[ticker] = { source: "historical", points: fixture, total: fixture.length };
    }
  }

  const threshold = DEFAULT_AGENT_LOOP_CONFIG.adjustedSpreadThreshold;

  try {
    const { spreads, opportunities, warmUp } = await getPreview();
    return NextResponse.json({ spreads, opportunities, warmUp, history, threshold });
  } catch (err) {
    // Live pool read failed (RPC down or slow, or BSC_RPC_URL not set).
    // History is still returned; spreads/opportunities come back empty
    // with a short public message, never a fabricated live value. The raw
    // error (viem's carries the RPC URL) goes to the server log only,
    // redacted.
    logServerError("live pool read for the dashboard failed", err);
    return NextResponse.json({
      spreads: [],
      opportunities: [],
      warmUp: {},
      history,
      threshold,
      error: `Live pool prices are temporarily unavailable (BNB Chain RPC: ${plainNetworkReason(err)}).`,
    });
  }
}

function toHistoryPoint({ timestamp, detection }: EvaluationPoint): SpreadHistoryPoint {
  return {
    timestamp: new Date(timestamp).toISOString(),
    cheapPoolPriceUsd: detection.cheapPool.priceUsd,
    cheapPoolFeeUnits: detection.cheapPool.feeUnits,
    expensivePoolPriceUsd: detection.expensivePool.priceUsd,
    expensivePoolFeeUnits: detection.expensivePool.feeUnits,
    rawSpread: detection.grossGap,
    adjustedSpread: detection.netEdge,
    reference: detection.reference,
  };
}
