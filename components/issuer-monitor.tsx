"use client";

import { usePoll } from "./use-poll";
import type { IssuerPanelSummary } from "./api-types";
import { issuerRows } from "./issuer-panel-view";

const POLL_MS = 30_000;
const signedPct = (v: number, d = 3) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const clock = (iso: string, seconds = false) => iso.slice(11, seconds ? 19 : 16);

// Issuer monitor: Microsoft's token from different issuers on BSC, per
// share, from the read-only cross-issuer recorder (/api/issuers/summary).
// Shows only the latest reading's numbers; a token without a valid quote
// shows why and when its last valid quote was. Monitor only.
export function IssuerMonitor() {
  const poll = usePoll<IssuerPanelSummary>("/api/issuers/summary", POLL_MS);
  const summary = poll.data;
  const rows = summary ? issuerRows(summary) : [];

  return (
    <section className="panel" id="issuers" aria-labelledby="issuers-title">
      <div className="panel-head">
        <h2 className="panel-title" id="issuers-title">
          Issuer monitor · MSFT across issuers
        </h2>
        {summary?.at && <span className="pill pill--plain mono">{clock(summary.at, true)} UTC</span>}
      </div>
      <p className="monitor-only">{summary ? summary.label : "Monitor only: Basis doesn't trade across issuers"}</p>

      {poll.loading && !summary && <p className="state-message">Loading issuer readings…</p>}
      {poll.error && <p className="state-message state-message--error">Issuer readings unavailable: {poll.error}</p>}

      {summary && (
        <>
          <p className="panel-note">
            Prices are compared <strong>per share</strong>: each token's price ÷ its shares multiplier (Binance's sharesMultiplier, checked
            every 5 minutes against the one each issuer publishes). Quotes are Binance Trading API quotes for ${summary.sizeUsd} of USDT;
            buys every 30 s, sells every 5 min. A round trip is estimated only when both of its quotes are at most {summary.freshLimitS} s old.
          </p>

          {summary.at === null ? (
            <p className="state-message">
              {summary.tokens.length === 0
                ? "No reading: no token could be confirmed through Binance's RWA API yet (reasons below)."
                : "No reading yet. The recorder starts about 15 s after the server does."}
            </p>
          ) : (
            <div className="issuer-table" role="table" aria-label="Latest per-share prices">
              <div className="issuer-row issuer-row--head" role="row">
                <span role="columnheader">Issuer</span>
                <span role="columnheader">Multiplier</span>
                <span role="columnheader">Buy / share</span>
                <span role="columnheader">Sell / share</span>
              </div>
              {rows.map((r) => (
                <div className={"issuer-row" + (r.ok ? "" : " issuer-row--none")} role="row" key={r.symbol}>
                  <span role="cell" className="issuer-name">
                    {r.issuer} <span className="mono">{r.symbol}</span>
                  </span>
                  <span role="cell" className="mono" data-label="Multiplier">
                    {r.multiplier}
                  </span>
                  <span role="cell" className="mono" data-label="Buy / share">
                    {r.buy}
                  </span>
                  <span role="cell" className="mono" data-label="Sell / share">
                    {r.sell}
                  </span>
                  {r.note && (
                    <span role="cell" className="issuer-note">
                      {r.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {summary.at !== null && (
            <div className="issuer-facts">
              <p>
                <span className="fact-label">Gap, latest reading</span>
                {summary.gap ? (
                  <span className="mono">
                    {summary.gap.cheapest} cheaper than {summary.gap.dearest} by {signedPct(summary.gap.grossPct)} per share
                  </span>
                ) : (
                  <span>none: it needs a valid buy price from two issuers in the same reading.</span>
                )}
              </p>
              <p>
                <span className="fact-label">Would it clear costs?</span>
                {summary.roundTrip ? (
                  <span>
                    Buy {summary.roundTrip.buy}, sell {summary.roundTrip.sell}:{" "}
                    <strong className={"mono " + (summary.roundTrip.clears ? "pos" : "neg")}>{signedPct(summary.roundTrip.netPct)}</strong> after the
                    quotes' own fees and price impact and ${summary.roundTrip.gasUsd.toFixed(3)} of gas for the two swaps.{" "}
                    {summary.roundTrip.clears ? "It would clear costs." : "It would not clear costs."}
                  </span>
                ) : summary.roundTripNote ? (
                  <span>no estimate: {summary.roundTripNote}</span>
                ) : (
                  <span>no estimate: it needs a valid buy on one issuer and a valid sell on another.</span>
                )}
              </p>
              <p>
                <span className="fact-label">Last hour</span>
                <span>
                  {summary.lastHour.readings} readings, {summary.lastHour.withEveryPrice} with a valid price from every issuer.
                  {summary.lastHour.largestGap && (
                    <>
                      {" "}
                      Largest gap <span className="mono">{signedPct(summary.lastHour.largestGap.grossPct)}</span> at {clock(summary.lastHour.largestGap.at)} UTC.
                    </>
                  )}
                  {summary.lastHour.bestRoundTrip && (
                    <>
                      {" "}
                      Best round trip <span className="mono">{signedPct(summary.lastHour.bestRoundTrip.netPct)}</span> (buy {summary.lastHour.bestRoundTrip.buy}, sell{" "}
                      {summary.lastHour.bestRoundTrip.sell}) at {clock(summary.lastHour.bestRoundTrip.at)} UTC
                      {summary.lastHour.bestRoundTrip.clears ? ", which would clear costs." : "; none cleared costs."}
                    </>
                  )}
                </span>
              </p>
            </div>
          )}

          {summary.excluded.map((x) => (
            <p className="panel-note" key={x.symbol}>
              <strong>
                {x.issuer} {x.symbol} is not included:
              </strong>{" "}
              {x.reason}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
