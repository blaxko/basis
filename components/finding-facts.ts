// The time-sensitive figures the landing page and the Findings page quote,
// in one place, so the two never disagree. Recounted from the cross-issuer
// recorder's export (basis-assessment/issuer-data, outside the repo) on
// 2026-10-04 11:05 UTC: fresh round trips are valid readings whose buy and
// sell quotes were both at most 60 s old. Recount before every deploy that
// shows them; test/site-pages.test.ts pins them.
//
// Every claim built from them is stamped with CHECKED_UNTIL, so it stays
// true after the code freeze whatever the market does next: it says what
// was found up to that date, never what is true now.

// The last day of data behind the claims ("in every reading we checked, up
// to 4 October 2026"), in prose and in the short form labels use.
export const CHECKED_UNTIL = "4 October 2026";
export const CHECKED_UNTIL_SHORT = "4 Oct 2026";

export const FINDING_FACTS = {
  roundTrips: {
    count: 222,
    cleared: 0,
    best: "−0.013%",
    median: "−0.21%",
    period: "26–30 Sep and 2–4 Oct 2026",
  },
  readings: {
    total: 13803,
    valid: 8521,
    asOf: "4 Oct 2026, 11:05 UTC",
  },
  // The recorder keeps the last 24 hours in memory and was exported in
  // between, so these stretches are missing from the record.
  gaps: "29 Sep 20:09–21:54 UTC and 30 Sep 05:48–2 Oct 22:52 UTC",
} as const;

// The round-trip finding's claim, dated; shared by the landing page and the
// Findings page.
export const ROUND_TRIPS_TITLE = `Up to ${CHECKED_UNTIL_SHORT}, none of ${FINDING_FACTS.roundTrips.count} round trips cleared costs`;
