import { FRESH_QUOTE_MAX_AGE_S, LABEL, QUOTE_SIZE_USD, SLOW_EVERY_TICKS, TICK_MS, type IssuerReading, type TokenConfirmation } from "./cross-issuer";

// What the dashboard's issuer monitor panel shows, from the recorder's own
// readings. Only the LATEST reading's numbers are shown. A token without a
// valid quote gets a plain reason and the time of its last valid quote —
// never a stale or made-up number. Monitor only: Basis doesn't trade
// across issuers.

export interface PanelToken {
  symbol: string;
  issuer: string;
  status: "ok" | "no_quote";
  multiplier: number | null; // Binance-implied, checked against the issuer's
  publishedMultiplier: number;
  buyPerShare: number | null;
  sellPerShare: number | null;
  sellAgeS: number | null;
  reason?: string; // why there's no buy price
  sellReason?: string; // why there's no sell price, when the buy is fine
  lastValidAt: string | null; // time of the last reading with a buy price
}

export interface IssuerPanelSummary {
  label: string;
  sizeUsd: number;
  at: string | null; // the latest reading
  tokens: PanelToken[];
  gap: IssuerReading["gap"];
  roundTrip: IssuerReading["roundTrip"];
  // Why the latest reading has no round trip although it has prices (a
  // stale leg), and when the next sell quotes are due.
  roundTripNote: string | null;
  freshLimitS: number;
  lastHour: {
    readings: number;
    withEveryPrice: number;
    largestGap: { grossPct: number; at: string } | null;
    bestRoundTrip: { netPct: number; buy: string; sell: string; clears: boolean; at: string } | null;
  };
  excluded: Array<{ symbol: string; issuer: string; reason: string }>;
}

const iso = (ms: number) => new Date(ms).toISOString();

// The recorder's error text, in words a visitor can read.
export function plainQuoteReason(error: string): string {
  if (/implausible sell quote/.test(error)) return "Binance's sell quote was implausible (more than 20% from bStocks per share), so it was rejected";
  if (/implausible quote/.test(error)) return "Binance's only quote was implausible (more than 20% from bStocks per share), so it was rejected";
  const e = error.replace(/^sell quote:\s*/, "");
  const code = e.match(/^code (\d+):\s*(.*)$/);
  if (code) return `Binance: ${code[2]} (code ${code[1]})`;
  const net = e.match(/^Binance:\s*(.*)$/);
  if (net) return `Binance didn't answer (${net[1]})`;
  return e;
}

export function issuerPanelSummary(readings: readonly IssuerReading[], confirmations: readonly TokenConfirmation[], nowMs: number): IssuerPanelSummary {
  const latest = readings[readings.length - 1];

  const tokens: PanelToken[] = confirmations
    .filter((c) => c.included)
    .map((c) => {
      const t = latest?.tokens.find((x) => x.symbol === c.symbol);
      let lastValidAt: string | null = null;
      for (let i = readings.length - 1; i >= 0; i--) {
        if (readings[i]!.tokens.some((x) => x.symbol === c.symbol && x.buyPerShare !== null)) {
          lastValidAt = iso(readings[i]!.t);
          break;
        }
      }
      const base = { symbol: c.symbol, issuer: c.issuer, multiplier: c.multiplier, publishedMultiplier: c.publishedMultiplier, lastValidAt };
      if (!t || t.buyPerShare === null) {
        return { ...base, status: "no_quote" as const, buyPerShare: null, sellPerShare: null, sellAgeS: null, reason: t?.error ? plainQuoteReason(t.error) : "no reading yet" };
      }
      return {
        ...base,
        status: "ok" as const,
        buyPerShare: t.buyPerShare,
        sellPerShare: t.sellPerShare,
        sellAgeS: t.sellPerShare === null ? null : t.sellAgeS,
        ...(t.sellPerShare === null && t.error ? { sellReason: plainQuoteReason(t.error) } : {}),
      };
    });

  const hour = readings.filter((r) => r.t >= nowMs - 3_600_000 && r.t <= nowMs);
  let largestGap: IssuerPanelSummary["lastHour"]["largestGap"] = null;
  let bestRoundTrip: IssuerPanelSummary["lastHour"]["bestRoundTrip"] = null;
  for (const r of hour) {
    if (r.gap && (!largestGap || r.gap.grossPct > largestGap.grossPct)) largestGap = { grossPct: r.gap.grossPct, at: iso(r.t) };
    if (r.roundTrip && (!bestRoundTrip || r.roundTrip.netPct > bestRoundTrip.netPct)) {
      bestRoundTrip = { netPct: r.roundTrip.netPct, buy: r.roundTrip.buy, sell: r.roundTrip.sell, clears: r.roundTrip.clears, at: iso(r.t) };
    }
  }

  const excluded = confirmations
    .filter((c) => !c.included)
    .map((c) => {
      const row = c.binanceRow as { platformId?: string | null; tokenPriceUpdatedAt?: number } | undefined;
      const stale = row?.tokenPriceUpdatedAt ? iso(row.tokenPriceUpdatedAt).slice(0, 10) : null;
      const down = c.reason?.match(/^Binance's RWA API: Binance: (.*)$/);
      const reason =
        row && !row.platformId && stale
          ? `Binance's RWA API returns it with no platform and a price last updated ${stale}, so it can't be confirmed as ${c.issuer}.`
          : down
            ? `Binance's RWA API didn't answer (${down[1]}), so it can't be confirmed yet.`
            : `${c.reason ?? "not confirmed"}.`;
      return { symbol: c.symbol, issuer: c.issuer, reason };
    });

  let roundTripNote: string | null = null;
  if (latest?.roundTripNote) {
    const ages = latest.tokens.map((t) => t.sellAgeS).filter((a): a is number => a !== null);
    const next = ages.length ? ` Next sell quotes due about ${iso(latest.t - Math.max(...ages) * 1000 + SLOW_EVERY_TICKS * TICK_MS).slice(11, 19)} UTC.` : "";
    roundTripNote = `${latest.roundTripNote}.${next}`;
  }

  return {
    label: LABEL,
    sizeUsd: QUOTE_SIZE_USD,
    at: latest ? iso(latest.t) : null,
    tokens,
    gap: latest?.gap ?? null,
    roundTrip: latest?.roundTrip ?? null,
    roundTripNote,
    freshLimitS: FRESH_QUOTE_MAX_AGE_S,
    lastHour: { readings: hour.length, withEveryPrice: hour.filter((r) => r.tokens.length >= 2 && r.tokens.every((t) => t.buyPerShare !== null)).length, largestGap, bestRoundTrip },
    excluded,
  };
}
