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

// "updated 20 s ago" / "updated 2 min ago"
export function ageLabel(ageS: number): string {
  return ageS < 90 ? `updated ${ageS} s ago` : `updated ${Math.round(ageS / 60)} min ago`;
}
