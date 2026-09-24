import { NextResponse } from "next/server";
import { previewOpportunities, DEFAULT_AGENT_LOOP_CONFIG } from "../../../lib/orchestration/agent-loop";
import { getDemoHistory, type SpreadHistoryPoint } from "../../../lib/data/demo-history";
import { defaultLedger, type AuditLedgerEntry } from "../../../lib/execution/audit-ledger";

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
export async function GET() {
  const history: Record<string, { source: "live" | "historical"; points: SpreadHistoryPoint[] }> = {};
  const entries = defaultLedger.readAll();

  for (const ticker of DEFAULT_AGENT_LOOP_CONFIG.underlyings) {
    const live = entries
      .filter((entry) => entry.detection?.ticker === ticker)
      .slice(-MAX_LIVE_POINTS)
      .map(toHistoryPoint);
    history[ticker] = live.length > 0 ? { source: "live", points: live } : { source: "historical", points: getDemoHistory(ticker) };
  }

  const threshold = DEFAULT_AGENT_LOOP_CONFIG.adjustedSpreadThreshold;

  try {
    const { spreads, opportunities } = await getPreview();
    return NextResponse.json({ spreads, opportunities, history, threshold });
  } catch (err) {
    // Live pool read failed (e.g. BSC_RPC_URL not configured). History is
    // still returned; spreads/opportunities come back empty with the
    // error message, never a fabricated live value. Message text only —
    // never the raw error object, which could carry env var names.
    return NextResponse.json({
      spreads: [],
      opportunities: [],
      history,
      threshold,
      error: err instanceof Error ? err.message : "failed to compute live spreads",
    });
  }
}

function toHistoryPoint(entry: AuditLedgerEntry): SpreadHistoryPoint {
  const detection = entry.detection!;
  return {
    timestamp: new Date(entry.timestamp).toISOString(),
    cheapPoolPriceUsd: detection.cheapPool.priceUsd,
    cheapPoolFeeUnits: detection.cheapPool.feeUnits,
    expensivePoolPriceUsd: detection.expensivePool.priceUsd,
    expensivePoolFeeUnits: detection.expensivePool.feeUnits,
    rawSpread: detection.grossGap,
    adjustedSpread: detection.netEdge,
  };
}
