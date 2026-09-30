"use client";

import { useEffect, useRef, useState } from "react";
import type { SpreadSeries } from "./api-types";
import { CHART_BAND_OPACITY } from "./theme";

// The live reading's chart, drawn as plain SVG (no charting library, so the
// dashboard ships far less JavaScript). Gross gap as a dashed line, net
// edge as a thicker solid line, on one axis that always includes zero, a
// labelled break-even line and the below-zero band. Colours are CSS
// variables (components/theme.ts), so it follows the light/dark theme.
// Hovering or tapping shows the values at that time in a small box that
// always stays inside the chart.

export const CHART_HEIGHT = 240;
// The plot plus its one-line legend: the box the dashboard reserves, so
// nothing moves when the first reading arrives.
export const LEGEND_HEIGHT = 28;
export const CHART_BOX_HEIGHT = CHART_HEIGHT + LEGEND_HEIGHT;
export const GROSS_GAP = "Gross gap";
export const NET_EDGE = "Net edge after costs";

const C = {
  gross: "var(--color-chart-gross)",
  net: "var(--color-chart-net)",
  zero: "var(--color-chart-zero)",
  band: "var(--color-chart-band)",
  grid: "var(--color-chart-grid)",
  axis: "var(--color-chart-axis)",
  text: "var(--color-text)",
} as const;

const M = { top: 8, right: 12, bottom: 22, left: 58 };

function signedPct(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function formatTime(iso: string, source: SpreadSeries["source"]): string {
  // Live points are seconds apart; fixture points are hours apart.
  return source === "live" ? iso.slice(11, 19) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

// Round tick steps, always including zero, so the break-even line is on
// screen and labeled even when every value sits on one side of it.
export function axisIncludingZero(values: number[]): { ticks: number[]; yMin: number; yMax: number } {
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
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = series.points;
  const { ticks, yMin, yMax } = axisIncludingZero(pts.flatMap((p) => [p.rawSpread, p.adjustedSpread]));
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = CHART_HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (pts.length <= 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const line = (key: "rawSpread" | "adjustedSpread") => pts.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const xTickIdx = pts.length <= 1 ? [0] : [...new Set([0, Math.round((pts.length - 1) / 2), pts.length - 1])];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pts.length === 0 || innerW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - M.left) / innerW;
    setHover(Math.min(pts.length - 1, Math.max(0, Math.round(rel * (pts.length - 1)))));
  };

  const latest = pts[pts.length - 1];
  const label = latest
    ? `Chart of the last ${pts.length} readings. Latest: gross gap ${signedPct(latest.rawSpread, 3)}, net edge ${signedPct(latest.adjustedSpread, 3)}.`
    : "Chart: no readings yet.";
  const h = hover === null ? null : pts[hover];

  return (
    <div className="chart-wrap">
      <div className="chart-plot" ref={box} style={{ height: CHART_HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={CHART_HEIGHT} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray="3 3" />
                <text x={M.left - 6} y={y(t) + 3.5} textAnchor="end" className="chart-tick">
                  {signedPct(t)}
                </text>
              </g>
            ))}
            {xTickIdx.map((i) => (
              <text key={i} x={x(i)} y={CHART_HEIGHT - 6} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="chart-tick">
                {pts[i] ? formatTime(pts[i]!.timestamp, series.source) : ""}
              </text>
            ))}
            <rect x={M.left} y={y(0)} width={innerW} height={Math.max(0, y(yMin) - y(0))} fill={C.band} opacity={CHART_BAND_OPACITY} />
            {y(yMin) - y(0) > 40 && (
              <text x={M.left + innerW / 2} y={(y(0) + y(yMin)) / 2 + 4} textAnchor="middle" fill={C.band} fontSize="11">
                below zero: doesn't clear costs
              </text>
            )}
            <line x1={M.left} x2={M.left + innerW} y1={y(0)} y2={y(0)} stroke={C.zero} strokeWidth="1.5" strokeDasharray="3 3" />
            <text x={M.left + 6} y={y(0) + 13} fill={C.text} fontSize="10">
              0 = break-even
            </text>
            <polyline points={line("rawSpread")} fill="none" stroke={C.gross} strokeWidth="1.75" strokeDasharray="4 3" />
            <polyline points={line("adjustedSpread")} fill="none" stroke={C.net} strokeWidth="2.25" />
            {h && hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} stroke={C.axis} />
                <circle cx={x(hover)} cy={y(h.rawSpread)} r="3.5" fill={C.gross} />
                <circle cx={x(hover)} cy={y(h.adjustedSpread)} r="3.5" fill={C.net} />
              </g>
            )}
          </svg>
        )}
        {h && hover !== null && (
          // Beside the pointer, on whichever side has room: always inside the chart.
          <div className="chart-tip mono" style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}>
            <div>{formatTime(h.timestamp, series.source)}</div>
            <div className="chart-tip-gross">Gross gap: {signedPct(h.rawSpread, 3)}</div>
            <div>Net edge: {signedPct(h.adjustedSpread, 3)}</div>
          </div>
        )}
      </div>
      <ul className="chart-legend">
        <li>
          <span className="chart-key chart-key--gross" aria-hidden="true" />
          {GROSS_GAP}
        </li>
        <li>
          <span className="chart-key chart-key--net" aria-hidden="true" />
          {NET_EDGE}
        </li>
      </ul>
    </div>
  );
}
