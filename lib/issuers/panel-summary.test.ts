import { describe, it, expect } from "vitest";
import { issuerPanelSummary, plainQuoteReason } from "./panel-summary";
import type { IssuerReading, TokenConfirmation } from "./cross-issuer";

// The issuer monitor panel shows ONLY the latest reading's numbers. When a
// token has no valid quote it says why, in plain words, and when the last
// valid one was — never a stale or made-up number.

const T = Date.parse("2026-09-28T17:00:00Z");
const msftb = (buy: number, sell: number | null = null) => ({ symbol: "MSFTB" as const, issuer: "bStocks" as const, multiplier: 1.0013139, buyPerToken: buy * 1.0013139, buyPerShare: buy, sellPerShare: sell, sellAgeS: sell === null ? null : 60 });
const ondoOk = (buy: number, sell: number | null = null) => ({ symbol: "MSFTon" as const, issuer: "Ondo" as const, multiplier: 1.0057308, buyPerToken: buy * 1.0057308, buyPerShare: buy, sellPerShare: sell, sellAgeS: sell === null ? null : 60 });
const ondoErr = (error: string) => ({ symbol: "MSFTon" as const, issuer: "Ondo" as const, multiplier: 1.0057308, buyPerToken: null, buyPerShare: null, sellPerShare: null, sellAgeS: null, error });

const conf: TokenConfirmation[] = [
  { symbol: "MSFTB", issuer: "bStocks", address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0", included: true, platformId: "bstock", multiplier: 1.0013139, publishedMultiplier: 1.001313964833366845, multiplierMatches: true },
  {
    symbol: "MSFTx",
    issuer: "xStocks",
    address: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35",
    included: false,
    reason: "Binance's RWA API returned it without a platformId, so it can't be confirmed as xStocks",
    platformId: null,
    multiplier: null,
    publishedMultiplier: 1.0059033904787456,
    multiplierMatches: false,
    // Real row, 2026-09-27 02:05 UTC (docs/devex-log.md)
    binanceRow: { tokenContractAddress: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35", platformId: undefined, tokenPrice: "491.85606822997883867475", referencePrice: "491.85606822997883867475", tokenPriceUpdatedAt: 1788895000000 } as never,
  },
  { symbol: "MSFTon", issuer: "Ondo", address: "0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3", included: true, platformId: "ondo", multiplier: 1.0057308, publishedMultiplier: 1.005730856892783903, multiplierMatches: true },
];

const reading = (minutesAgo: number, tokens: IssuerReading["tokens"], gap: IssuerReading["gap"] = null, roundTrip: IssuerReading["roundTrip"] = null): IssuerReading => ({ t: T - minutesAgo * 60_000, tokens, gap, roundTrip });

describe("plain reasons for 'no valid quote'", () => {
  it.each([
    ["implausible quote: $1.02463e+9 per share vs bStocks $512.56 (raw quote in status)", "Binance's only quote was implausible (more than 20% from bStocks per share), so it was rejected"],
    ["code 40367: The stock market is currently closed. Expected to open in 2d 5h", "Binance: The stock market is currently closed. Expected to open in 2d 5h (code 40367)"],
    ["Binance: timed out", "Binance didn't answer (timed out)"],
    ["sell quote: code 40374: Insufficient liquidity for a quote.", "Binance: Insufficient liquidity for a quote. (code 40374)"],
  ])("%s", (raw, plain) => expect(plainQuoteReason(raw)).toBe(plain));
});

describe("issuerPanelSummary", () => {
  it("Ondo with no valid quote: no number, the plain reason, and when the last valid quote was", () => {
    const readings = [
      reading(40, [msftb(512.4), ondoOk(512.1)], { cheapest: "MSFTon", dearest: "MSFTB", grossPct: 0.0006 }),
      reading(0, [msftb(512.56, 509.96), ondoErr("implausible quote: $1.02463e+9 per share vs bStocks $512.56 (raw quote in status)")]),
    ];
    const s = issuerPanelSummary(readings, conf, T);
    const ondo = s.tokens.find((t) => t.symbol === "MSFTon")!;
    expect(ondo).toMatchObject({ status: "no_quote", buyPerShare: null, sellPerShare: null, lastValidAt: "2026-09-28T16:20:00.000Z" });
    expect(ondo.reason).toMatch(/implausible/);
    expect(s.gap).toBeNull(); // from the latest reading only
    expect(s.tokens.find((t) => t.symbol === "MSFTB")).toMatchObject({ status: "ok", buyPerShare: 512.56, sellPerShare: 509.96, sellAgeS: 60 });
  });

  it("both priced: the latest gap and round trip, and the last hour's figures", () => {
    const rt = { buy: "MSFTon", sell: "MSFTB", netPct: -0.0015, gasUsd: 0.024, clears: false };
    const readings = [
      reading(90, [msftb(510), ondoOk(500)], { cheapest: "MSFTon", dearest: "MSFTB", grossPct: 0.02 }), // outside the hour
      reading(30, [msftb(512.5), ondoOk(511.9)], { cheapest: "MSFTon", dearest: "MSFTB", grossPct: 0.00117 }, { ...rt, netPct: -0.0012 }),
      reading(10, [msftb(512.5), ondoErr("code 40367: The stock market is currently closed.")]),
      reading(0, [msftb(512.6, 511.0), ondoOk(512.2, 510.4)], { cheapest: "MSFTon", dearest: "MSFTB", grossPct: 0.00078 }, rt),
    ];
    const s = issuerPanelSummary(readings, conf, T);
    expect(s.gap).toEqual({ cheapest: "MSFTon", dearest: "MSFTB", grossPct: 0.00078 });
    expect(s.roundTrip).toEqual(rt);
    expect(s.lastHour).toEqual({
      readings: 3,
      withEveryPrice: 2,
      largestGap: { grossPct: 0.00117, at: "2026-09-28T16:30:00.000Z" },
      bestRoundTrip: { netPct: -0.0012, buy: "MSFTon", sell: "MSFTB", clears: false, at: "2026-09-28T16:30:00.000Z" },
    });
    expect(s.at).toBe("2026-09-28T17:00:00.000Z");
  });

  it("no round trip because a quote is stale: says why, and when the next sell quotes are due", () => {
    const stale = { ...reading(0, [msftb(512.6, 511.0), ondoOk(512.2, 510.4)], { cheapest: "MSFTon", dearest: "MSFTB", grossPct: 0.00078 }), roundTripNote: "the sell quotes are 90 s old; an estimate needs both quotes at most 60 s old" };
    stale.tokens = stale.tokens.map((t) => ({ ...t, sellAgeS: 90 }));
    const s = issuerPanelSummary([stale], conf, T);
    expect(s.roundTrip).toBeNull();
    // sells were quoted at 16:58:30; they're quoted every 5 min
    expect(s.roundTripNote).toBe("the sell quotes are 90 s old; an estimate needs both quotes at most 60 s old. Next sell quotes due about 17:03:30 UTC.");
    expect(s.freshLimitS).toBe(60);
  });

  it("with a fresh round trip there's no note", () => {
    const rt = { buy: "MSFTon", sell: "MSFTB", netPct: -0.0015, gasUsd: 0.024, clears: false };
    const s = issuerPanelSummary([reading(0, [msftb(512.6, 511.0), ondoOk(512.2, 510.4)], null, rt)], conf, T);
    expect(s.roundTrip).toEqual(rt);
    expect(s.roundTripNote).toBeNull();
  });

  it("explains xStocks' exclusion with Binance's real, stale date", () => {
    const s = issuerPanelSummary([], conf, T);
    expect(s.excluded).toEqual([
      {
        symbol: "MSFTx",
        issuer: "xStocks",
        reason: "Binance's RWA API returns it with no platform and a price last updated 2026-09-08, so it can't be confirmed as xStocks.",
      },
    ]);
  });

  it("when Binance's RWA API didn't answer, says so plainly", () => {
    const down = conf.map((c) => ({ ...c, included: false, binanceRow: undefined, reason: "Binance's RWA API: Binance: network error" }));
    expect(issuerPanelSummary([], down, T).excluded[0]!.reason).toBe("Binance's RWA API didn't answer (network error), so it can't be confirmed yet.");
  });

  it("with no readings: no numbers at all", () => {
    const s = issuerPanelSummary([], conf, T);
    expect(s.at).toBeNull();
    expect(s.gap).toBeNull();
    expect(s.roundTrip).toBeNull();
    expect(s.lastHour).toEqual({ readings: 0, withEveryPrice: 0, largestGap: null, bestRoundTrip: null });
    for (const t of s.tokens) expect(t.buyPerShare).toBeNull();
  });
});
