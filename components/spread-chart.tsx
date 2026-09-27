"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SpreadSeries } from "./api-types";
import { TOKENS, CHART_BAND_OPACITY } from "./theme";

// The Pool Spread Monitor's chart. Loaded lazily (next/dynamic, no SSR) into
// a fixed-height box, so the charting library doesn't hold up first paint
// and nothing moves when it arrives.

const AXIS_TICK = { fontSize: 10, fill: TOKENS.chartAxis, fontFamily: "var(--font-mono)" };
export const GROSS_GAP = "Gross gap between pools";
export const NET_EDGE = "Net edge after fees, slippage, gas";
export const CHART_HEIGHT = 240;

function signedPct(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function formatTime(iso: string, source: SpreadSeries["source"]): string {
  // Live points are seconds apart; fixture points are hours apart.
  return source === "live" ? iso.slice(11, 19) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
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

export default function SpreadChart({ series }: { series: SpreadSeries }) {
  const chartData = series.points.map((p) => ({ time: formatTime(p.timestamp, series.source), [GROSS_GAP]: p.rawSpread, [NET_EDGE]: p.adjustedSpread }));
  const { ticks, yMin, yMax } = axisIncludingZero(series.points.flatMap((p) => [p.rawSpread, p.adjustedSpread]));

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={chartData} margin={{ top: 8, right: 28, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={TOKENS.chartGrid} />
        <ReferenceArea
          y1={yMin}
          y2={0}
          fill={TOKENS.chartBand}
          fillOpacity={CHART_BAND_OPACITY}
          ifOverflow="hidden"
          label={{ value: "below zero: doesn't clear costs", position: "center", fontSize: 11, fill: TOKENS.chartBand }}
        />
        <XAxis dataKey="time" tick={AXIS_TICK} stroke={TOKENS.chartAxis} minTickGap={24} />
        <YAxis domain={[yMin, yMax]} ticks={ticks} tickFormatter={(v: number) => signedPct(v)} tick={AXIS_TICK} stroke={TOKENS.chartAxis} width={64} />
        <ReferenceLine y={0} stroke={TOKENS.chartZero} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: "0 = break-even", position: "insideTopLeft", offset: 6, fontSize: 10, fill: TOKENS.text }} />
        <Tooltip
          formatter={(value) => signedPct(Number(value), 3)}
          contentStyle={{ background: TOKENS.surface, border: `1px solid ${TOKENS.chartGrid}`, color: TOKENS.text, fontFamily: "var(--font-mono)", fontSize: 12 }}
          labelStyle={{ color: TOKENS.text }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {/* Same axis for both lines on purpose: the distance between them
            is the real cost of trading, not an artifact of two scales. */}
        <Line type="monotone" dataKey={GROSS_GAP} stroke={TOKENS.chartGross} strokeWidth={1.75} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey={NET_EDGE} stroke={TOKENS.chartNet} strokeWidth={2.25} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
