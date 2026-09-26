// Counter labels for capped lists. The routes return at most 120 chart
// points and 300 ledger entries, but report the true totals, so a count
// keeps increasing for as long as the server runs, and a capped list says
// that it is capped. Pure; tested in test/counters.test.ts.

const n = (value: number) => value.toLocaleString("en-US");

// The Pool Spread Monitor's tag: every evaluation this session, and how
// many of them the chart shows once that's fewer.
export function evaluationsTag(total: number, shown: number): string {
  const base = `LIVE · ${n(total)} evaluation${total === 1 ? "" : "s"} this session`;
  return total > shown ? `${base} · chart shows the last ${n(shown)}` : base;
}

// The Audit Ledger's note when it isn't showing everything, else null.
export function ledgerShowingNote(total: number, shown: number): string | null {
  return total > shown ? `Showing the newest ${n(shown)} of ${n(total)} entries.` : null;
}
