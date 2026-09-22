"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePoll } from "./use-poll";
import type { OpportunitiesResponse, SpreadHistoryPoint } from "./api-types";

const POLL_MS = 15_000;

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function NavSpreadMonitor() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);

  const history = poll.data?.history ?? {};
  const tickers = Object.keys(history);

  return (
    <section className="panel">
      <h2 className="panel-title">NAV Spread Monitor</h2>

      {poll.loading && !poll.data && <p className="state-message">Loading spreads…</p>}
      {poll.error && <p className="state-message state-message--error">Failed to load spreads: {poll.error}</p>}
      {poll.data?.error && (
        <p className="state-message state-message--error">
          Live quotes unavailable ({poll.data.error}) — showing seeded demo data where available.
        </p>
      )}

      {tickers.length === 0 && !poll.loading && !poll.error && (
        <p className="state-message">No underlyings configured.</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {tickers.map((ticker) => (
          <TickerChart key={ticker} ticker={ticker} points={history[ticker] ?? []} />
        ))}
      </div>
    </section>
  );
}

function TickerChart({ ticker, points }: { ticker: string; points: SpreadHistoryPoint[] }) {
  if (points.length === 0) {
    return (
      <div>
        <h3 style={{ fontSize: "0.95rem", marginBottom: 4 }}>{ticker}</h3>
        <p className="state-message">No data yet.</p>
      </div>
    );
  }

  const chartData = points.map((p) => ({
    date: p.date,
    "Raw spread": p.rawSpread,
    "Adjusted spread": p.adjustedSpread,
  }));

  return (
    <div>
      <h3 style={{ fontSize: "0.95rem", marginBottom: 4 }}>{ticker}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd8cc" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={pct} tick={{ fontSize: 10 }} width={60} />
          <Tooltip formatter={(value) => pct(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {/* Raw spread: thin, dashed, amber — the false signal. Adjusted
              spread: thick, solid, near-black — the real, trusted one.
              Same shared axis deliberately (no second Y-axis), so a
              spike vs. flat line reads as an actual magnitude difference,
              not an artifact of independent auto-scaling. */}
          <Line
            type="monotone"
            dataKey="Raw spread"
            stroke="#b8860b"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={{ r: 2 }}
          />
          <Line type="monotone" dataKey="Adjusted spread" stroke="#0d0d0d" strokeWidth={3} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
