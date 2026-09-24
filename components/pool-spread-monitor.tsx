"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePoll } from "./use-poll";
import type { OpportunitiesResponse, SpreadSeries } from "./api-types";

const POLL_MS = 15_000;

const GROSS_GAP = "Gross gap between pools";
const NET_EDGE = "Net edge after fees, slippage, gas";

function signedPct(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function feeLabel(feeUnits: number): string {
  return `${feeUnits / 10_000}%`;
}

export function PoolSpreadMonitor() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);
  const history = poll.data?.history ?? {};
  const tickers = Object.keys(history);
  const threshold = poll.data?.threshold ?? 0;

  return (
    <section className="panel">
      <h2 className="panel-title">Pool Spread Monitor</h2>

      {poll.loading && !poll.data && <p className="state-message">Loading pool spreads…</p>}
      {poll.error && <p className="state-message state-message--error">Failed to load spreads: {poll.error}</p>}
      {poll.data?.error && (
        <p className="state-message state-message--error">Live pool read unavailable: {poll.data.error}</p>
      )}

      {tickers.length === 0 && !poll.loading && !poll.error && (
        <p className="state-message">No tickers with two or more registered pools.</p>
      )}

      {tickers.map((ticker) => (
        <TickerChart key={ticker} ticker={ticker} series={history[ticker]!} threshold={threshold} />
      ))}
    </section>
  );
}

function TickerChart({ ticker, series, threshold }: { ticker: string; series: SpreadSeries; threshold: number }) {
  const { points, source } = series;
  const latest = points[points.length - 1];

  if (!latest) {
    return (
      <div>
        <h3 className="monitor-ticker">{ticker}</h3>
        <p className="state-message">No data yet.</p>
      </div>
    );
  }

  const chartData = points.map((p) => ({
    time: formatTime(p.timestamp, source),
    [GROSS_GAP]: p.rawSpread,
    [NET_EDGE]: p.adjustedSpread,
  }));

  const values = points.flatMap((p) => [p.rawSpread, p.adjustedSpread]);
  const { ticks, yMin, yMax } = axisIncludingZero(values);
  const clears = latest.adjustedSpread > Math.max(0, threshold);

  return (
    <div className="monitor-ticker-block">
      <div className="monitor-ticker-header">
        <h3 className="monitor-ticker">{ticker} · PancakeSwap V3 pools</h3>
        <span className={"source-tag " + (source === "live" ? "source-tag--live" : "source-tag--historical")}>
          {source === "live"
            ? `LIVE · ${points.length} evaluation${points.length === 1 ? "" : "s"} this session`
            : "HISTORICAL FIXTURE · 2026-09-18 → 09-21 · NOT LIVE"}
        </span>
      </div>

      <p className="reading-line mono">
        {source === "live" ? "Latest" : "Last fixture point"}: {feeLabel(latest.cheapPoolFeeUnits)} pool $
        {latest.cheapPoolPriceUsd.toFixed(2)} · {feeLabel(latest.expensivePoolFeeUnits)} pool $
        {latest.expensivePoolPriceUsd.toFixed(2)} · gross gap {signedPct(latest.rawSpread)} · net edge{" "}
        <strong className={clears ? "reading-clears" : "reading-declines"}>{signedPct(latest.adjustedSpread)}</strong>
        {" → "}
        {clears ? "clears threshold" : "no opportunity"}
      </p>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd8cc" />
          <ReferenceArea
            y1={yMin}
            y2={0}
            fill="#c81e1e"
            fillOpacity={0.06}
            ifOverflow="hidden"
            label={{ value: "below zero: doesn't clear costs", position: "center", fontSize: 11, fill: "#c81e1e" }}
          />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={24} />
          <YAxis domain={[yMin, yMax]} ticks={ticks} tickFormatter={(v: number) => signedPct(v)} tick={{ fontSize: 10 }} width={64} />
          <ReferenceLine
            y={0}
            stroke="#0d0d0d"
            strokeWidth={2}
            label={{ value: "0 = break-even", position: "insideTopLeft", fontSize: 10 }}
          />
          <Tooltip formatter={(value) => signedPct(Number(value), 3)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {/* Same axis for both lines on purpose: the distance between them
              is the real cost of trading, not an artifact of two scales. */}
          <Line
            type="monotone"
            dataKey={GROSS_GAP}
            stroke="#b8860b"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey={NET_EDGE}
            stroke="#0d0d0d"
            strokeWidth={3}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Round tick steps, always including zero, so the break-even line is on
// screen and labeled even when every value sits on one side of it.
function axisIncludingZero(values: number[]): { ticks: number[]; yMin: number; yMax: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const rough = Math.max(hi - lo, 0.001) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const ticks: number[] = [];
  for (let i = first; i <= Math.max(last, first + 1); i++) ticks.push(i * step);
  return { ticks, yMin: ticks[0]!, yMax: ticks[ticks.length - 1]! };
}

function formatTime(iso: string, source: SpreadSeries["source"]): string {
  // Live points are seconds apart; fixture points are hours apart.
  return source === "live" ? iso.slice(11, 19) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}
