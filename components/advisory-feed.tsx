"use client";

import { usePoll } from "./use-poll";
import type { OpportunitiesResponse } from "./api-types";

// Polls /api/opportunities rather than streaming: narration is a
// server-side Groq call (Phase 4), so it must come from the server's
// already-narrated `opportunities[]` — re-narrating client-side from raw
// spreads would mean either shipping a Groq key to the browser or
// duplicating the LLM call path outside lib/llm/'s own boundary, both
// wrong. No SSE/websocket infra exists in this stack yet, and the route
// is cheap (pure computation, no I/O side effects), so a ~10s poll is
// indistinguishable from live for a demo.
const POLL_MS = 10_000;

export function AdvisoryFeed() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);
  const opportunities = poll.data?.opportunities ?? [];

  return (
    <section className="panel panel--terminal">
      <h2 className="panel-title mono">LLM Advisory Feed</h2>

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
              [{opportunity.ticker}] adjusted spread {(opportunity.order.adjustedSpread * 100).toFixed(2)}%
            </div>
            <div>{opportunity.narration}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
