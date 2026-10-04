"use client";

import { useEffect, useState } from "react";
import type { LiveReading, ReadingResponse } from "./api-types";
import { ageLabel, liveReadingView, readingVerdict } from "./live-reading-view";

const POLL_MS = 30_000;
const TICK_MS = 5_000;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(3)}%`;
const usd = (v: number) => `$${v.toFixed(2)}`;

// The landing page's hero card. It arrives server-rendered with the latest
// real reading (app/page.tsx), so there is never a loading state; the
// browser then refreshes it from /api/reading every 30 s. The card keeps
// its size in every state, so nothing moves.
export function LandingLiveReading({ initial, renderedAt }: { initial: LiveReading | null; renderedAt: number }) {
  const [reading, setReading] = useState<LiveReading | null>(initial);
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const res = await fetch("/api/reading", { cache: "no-store" });
        if (res.ok && alive) setReading(((await res.json()) as ReadingResponse).reading);
      } catch {
        // Keep the last reading; its age shows how old it is, and it turns
        // "unavailable" once it's too old to call live.
      }
    };
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    setNow(Date.now());
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const view = liveReadingView(reading, now);

  return (
    <div className="live-card" aria-live="polite">
      <div className="live-head">
        <span className="live-title">
          <span className={"status-dot" + (view.kind === "ok" ? " status-dot--ok" : " status-dot--unknown")} aria-hidden="true" />
          Live reading · MSFTB / USDT
        </span>
        {view.kind === "ok" && (
          <span className="live-time" suppressHydrationWarning>
            {ageLabel(view.ageS)}
          </span>
        )}
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
            For a ${view.tradeSizeUsd} trade at {view.at.slice(11, 19)} UTC.{" "}
            {readingVerdict(view.netEdge)}
          </p>
        </>
      ) : (
        <div className="live-empty">
          <p>Live reading unavailable.</p>
          <p>
            <a href="/app">Open the dashboard</a>
          </p>
        </div>
      )}
    </div>
  );
}
