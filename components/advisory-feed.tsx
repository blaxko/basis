"use client";

import { usePoll } from "./use-poll";
import type { OpportunitiesResponse } from "./api-types";

// Shows the server's already-narrated `opportunities[]`. The narration is
// a fixed text template (lib/llm/proposal-narrator.ts) filled from the
// Basis Model's numbers and the guardrail verdict — no AI writes it. The
// AI (Groq) is only used to read typed instructions. Polls every ~10 s,
// which is indistinguishable from live for a demo.
const POLL_MS = 10_000;

export function AdvisoryFeed() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);
  const opportunities = poll.data?.opportunities ?? [];

  return (
    <section className="panel panel--terminal">
      <h2 className="panel-title mono">Advisory Feed</h2>
      <p className="state-message mono">generated from fixed templates, not written by the AI</p>

      {poll.loading && !poll.data && <p className="state-message mono">connecting…</p>}
      {poll.error && <p className="state-message state-message--error mono">feed unavailable: {poll.error}</p>}
      {poll.data?.error && (
        <p className="state-message state-message--error mono">live scan unavailable: {poll.data.error}</p>
      )}

      <div className="terminal-feed">
        {opportunities.length === 0 && !poll.loading && (
          <p className="terminal-empty mono">no opportunities currently clear the threshold.</p>
        )}

        {opportunities.map((opportunity, i) => (
          <div className="terminal-line" key={`${opportunity.ticker}-${i}`}>
            <div className="terminal-line-meta">
              [{opportunity.ticker}] net edge {(opportunity.order.adjustedSpread * 100).toFixed(2)}%
            </div>
            <div>{opportunity.narration}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
