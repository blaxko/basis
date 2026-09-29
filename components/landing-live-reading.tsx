"use client";

import { usePoll } from "./use-poll";
import type { OpportunitiesResponse } from "./api-types";
import { liveReadingView } from "./live-reading-view";

const POLL_MS = 30_000;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(3)}%`;
const usd = (v: number) => `$${v.toFixed(2)}`;

// The landing page's hero card: the dashboard's latest live reading, from
// our own API, every 30 s. The card keeps its size in every state, so
// nothing moves when the numbers arrive.
export function LandingLiveReading() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);
  const view = liveReadingView(poll.data, poll.error);

  return (
    <div className="live-card" aria-live="polite">
      <div className="live-head">
        <span className="live-title">
          <span className={"status-dot" + (view.kind === "ok" ? " status-dot--ok" : " status-dot--unknown")} aria-hidden="true" />
          Live reading · MSFTB / USDT
        </span>
        {view.kind === "ok" && <span className="live-time mono">{view.at.slice(11, 19)} UTC</span>}
      </div>

      {view.kind === "ok" ? (
        <>
          <div className="live-pools">
            {view.pools.map((p) => (
              <div key={p.fee}>
                <div className="live-label">{p.fee} pool</div>
                <div className="live-price mono">{usd(p.priceUsd)}</div>
              </div>
            ))}
          </div>
          <dl className="live-rows">
            <div className="live-row">
              <dt>Gross gap</dt>
              <dd className="mono">{pct(view.grossGap)}</dd>
            </div>
            <div className="live-row">
              <dt>Total costs (fees, slippage, gas)</dt>
              <dd className="mono neg">{pct(view.totalCost)}</dd>
            </div>
            <div className="live-row live-row--net">
              <dt>Net edge</dt>
              <dd className={"mono " + (view.netEdge > 0 ? "pos" : "neg")}>{pct(view.netEdge)}</dd>
            </div>
          </dl>
          <p className="live-foot">
            For a ${view.tradeSizeUsd} trade. {view.netEdge > 0 ? "Above zero: the guardrails decide next." : "Below zero: Basis records \"no opportunity\" and does nothing."} Updates
            every 30 s.
          </p>
        </>
      ) : (
        <div className="live-empty">
          <p>{view.kind === "loading" ? "Loading the live reading…" : "Live reading unavailable."}</p>
          {view.kind === "unavailable" && (
            <p>
              <a href="/app">Open the dashboard</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
