// The time-sensitive figures the landing page and the Findings page quote,
// in one place, so the two never disagree. Recounted from the cross-issuer
// recorder's export (basis-assessment/issuer-data, outside the repo) on
// 2026-10-03 23:58 UTC: fresh round trips are valid readings whose buy and
// sell quotes were both at most 60 s old. Recount before every deploy that
// shows them; test/site-pages.test.ts pins them.

export const FINDING_FACTS = {
  roundTrips: {
    count: 196,
    cleared: 0,
    best: "−0.013%",
    median: "−0.21%",
    period: "26–30 Sep and 2–3 Oct 2026",
  },
  readings: {
    total: 12479,
    valid: 7197,
    asOf: "3 Oct 2026, 23:58 UTC",
  },
  // The recorder keeps the last 24 hours in memory and was exported in
  // between, so these stretches are missing from the record.
  gaps: "29 Sep 20:09–21:54 UTC and 30 Sep 05:48–2 Oct 22:52 UTC",
} as const;
