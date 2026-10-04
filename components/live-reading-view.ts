import type { LiveReading } from "./api-types";

// What the landing page's live reading shows: the latest recorded
// evaluation (/api/reading) and how old it is. Without one, or when the
// last one is too old to call live, it's "unavailable", with no number at
// all.
export type LiveReadingView = { kind: "unavailable" } | ({ kind: "ok"; ageS: number } & LiveReading);

// The scheduler records one every 30 s; older than this, it isn't live.
export const STALE_AFTER_S = 180;

export function liveReadingView(reading: LiveReading | null | undefined, nowMs: number): LiveReadingView {
  if (!reading) return { kind: "unavailable" };
  const ageS = Math.max(0, Math.round((nowMs - Date.parse(reading.at)) / 1000));
  if (!Number.isFinite(ageS) || ageS > STALE_AFTER_S) return { kind: "unavailable" };
  return { kind: "ok", ageS, ...reading };
}

// An order is built only above this net edge: the agent loop's
// adjustedSpreadThreshold (lib/orchestration/agent-loop.ts), 0.01%.
export const ORDER_THRESHOLD = 0.0001;

// What a reading's net edge means, in one sentence, for the landing card
// and the worked example. Above the threshold Basis builds an order and the
// guardrails run on it, but nothing is ever sent from this build.
export function readingVerdict(netEdge: number): string {
  if (netEdge > ORDER_THRESHOLD) return "Above the 0.01% threshold: the guardrails decide next. On this demo nothing is ever sent.";
  if (netEdge > 0) return 'Positive, but not above the 0.01% threshold: Basis records "no opportunity" and sends nothing.';
  return 'Below zero: Basis records "no opportunity" and sends nothing.';
}

// "updated 20 s ago" / "updated 2 min ago"
export function ageLabel(ageS: number): string {
  return ageS < 90 ? `updated ${ageS} s ago` : `updated ${Math.round(ageS / 60)} min ago`;
}
