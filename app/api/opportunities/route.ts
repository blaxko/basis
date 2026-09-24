import { NextResponse } from "next/server";
import { previewOpportunities, DEFAULT_AGENT_LOOP_CONFIG, type UnderlyingSpread } from "../../../lib/orchestration/agent-loop";
import { getDemoHistory, type SpreadHistoryPoint } from "../../../lib/data/demo-history";

// Read-only by construction: previewOpportunities() calls check() (pure)
// for a live-accurate verdict, but never runPipeline() — a GET must
// never be able to trigger a guardrail/pipeline run or move money.
//
// `history` is separate from `spreads`/`opportunities`: it's seeded demo
// data (lib/data/demo-history.ts) for underlyings we have it for (MSFT),
// run through the real Basis Model functions, not live-fetched — so it's
// available even when BINANCE_WEB3_API_* credentials aren't configured,
// specifically so the NAV Spread Monitor's ex-div contrast is still
// demonstrable without live credentials.
export async function GET() {
  const history: Record<string, SpreadHistoryPoint[]> = {};
  for (const ticker of DEFAULT_AGENT_LOOP_CONFIG.underlyings) {
    history[ticker] = getDemoHistory(ticker);
  }

  try {
    const { spreads, opportunities } = await previewOpportunities();

    // Underlyings with no seeded series (everything but MSFT, currently)
    // fall back to their single live point, so the chart still has
    // something to plot per ticker.
    for (const spread of spreads) {
      if (history[spread.ticker]!.length === 0) {
        history[spread.ticker] = [liveSpreadAsHistoryPoint(spread)];
      }
    }

    return NextResponse.json({ spreads, opportunities, history });
  } catch (err) {
    // Live quote fetch failed (e.g. NotImplemented — no credentials
    // configured yet). The seeded history is still real and still
    // returned; spreads/opportunities come back empty with an error
    // message, never a fabricated live value. Message text only — never
    // the raw error object, which could carry env var names.
    return NextResponse.json({
      spreads: [],
      opportunities: [],
      history,
      error: err instanceof Error ? err.message : "failed to compute live spreads",
    });
  }
}

function liveSpreadAsHistoryPoint(spread: UnderlyingSpread): SpreadHistoryPoint {
  return {
    timestamp: new Date().toISOString(),
    cheapPoolPriceUsd: spread.cheapPool.priceUsd,
    cheapPoolFeeUnits: spread.cheapPool.feeUnits,
    expensivePoolPriceUsd: spread.expensivePool.priceUsd,
    expensivePoolFeeUnits: spread.expensivePool.feeUnits,
    rawSpread: spread.rawSpread,
    adjustedSpread: spread.adjustedSpread,
  };
}
