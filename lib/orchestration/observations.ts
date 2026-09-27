import type { EvaluationPoint } from "../execution/audit-ledger";
import type { MarketStatusChange } from "../data/binance-rwa";

// The Advisory Feed's observations: fixed sentence templates filled with
// real readings only (the scheduler's evaluations and Binance's RWA market
// status). No AI writes them, and with no data there is no observation.

export interface Observation {
  kind: "largest_gap" | "market_status";
  at: string; // ISO time the observation refers to
  text: string;
}

const HOUR_MS = 60 * 60_000;
const signed = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(3)}%`;
const clock = (iso: string, seconds: boolean) => iso.slice(11, seconds ? 19 : 16);

export function observations(ticker: string, evaluations: readonly EvaluationPoint[], statusChanges: readonly MarketStatusChange[], nowMs: number): Observation[] {
  const out: Observation[] = [];

  const hour = evaluations.filter((e) => e.timestamp >= nowMs - HOUR_MS && e.timestamp <= nowMs);
  if (hour.length > 0) {
    const widest = hour.reduce((a, e) => (e.detection.grossGap > a.detection.grossGap ? e : a));
    const best = Math.max(...hour.map((e) => e.detection.netEdge));
    const at = new Date(widest.timestamp).toISOString();
    out.push({
      kind: "largest_gap",
      at,
      text:
        `Largest gross gap between the pools in the last hour: ${signed(widest.detection.grossGap)} at ${clock(at, true)} UTC ` +
        `(net edge ${signed(widest.detection.netEdge)}). Best net edge in the hour: ${signed(best)}. ` +
        (best > 0 ? "At least one reading cleared costs." : "Both below zero after costs."),
    });
  }

  if (statusChanges.length === 1) {
    const first = statusChanges[0]!;
    out.push({ kind: "market_status", at: first.at, text: `${ticker} underlying market (Binance RWA status): ${first.to}, unchanged since ${clock(first.at, false)} UTC.` });
  } else {
    for (const c of statusChanges.slice(1).slice(-3).reverse()) {
      out.push({ kind: "market_status", at: c.at, text: `${ticker} underlying market (Binance RWA status): ${c.from} → ${c.to} at ${clock(c.at, false)} UTC.` });
    }
  }
  return out;
}
