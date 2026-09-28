import type { IssuerPanelToken } from "./api-types";

// Display strings for the issuer monitor's rows, from the latest reading
// only. A token without a valid quote shows the reason and when its last
// valid quote was: never a number. Pure; tested in test/issuer-panel.test.ts.

export interface IssuerRow {
  symbol: string;
  issuer: string;
  multiplier: string;
  buy: string;
  sell: string;
  note: string | null;
  ok: boolean;
}

const usd = (v: number) => `$${v.toFixed(2)}`;
const age = (s: number) => (s < 60 ? `${s}s old` : `${Math.floor(s / 60)} min old`);

export function issuerRows({ tokens }: { tokens: readonly IssuerPanelToken[] }): IssuerRow[] {
  return tokens.map((t) => {
    const multiplier = t.multiplier === null ? "—" : `×${t.multiplier.toFixed(6)}`;
    if (t.status !== "ok" || t.buyPerShare === null) {
      const last = t.lastValidAt ? ` · last valid quote ${t.lastValidAt.slice(11, 16)} UTC` : " · no valid quote yet";
      return { symbol: t.symbol, issuer: t.issuer, multiplier, buy: "no valid quote", sell: "—", note: `${t.reason ?? "no quote"}${last}`, ok: false };
    }
    const sell = t.sellPerShare !== null && t.sellAgeS !== null ? `${usd(t.sellPerShare)} (${age(t.sellAgeS)})` : "no valid quote";
    return { symbol: t.symbol, issuer: t.issuer, multiplier, buy: usd(t.buyPerShare), sell, note: t.sellPerShare === null && t.sellReason ? `sell: ${t.sellReason}` : null, ok: true };
  });
}
