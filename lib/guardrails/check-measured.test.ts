import { describe, it, expect } from "vitest";
import { check, type ProposedOrder } from "./check";
import { DEFAULT_GUARDRAIL_CONFIG } from "./config";

// Every guardrail row on the dashboard shows the check's real threshold
// (from config) and the value it actually measured, reported by check()
// itself so the UI never hard-codes a number.

// A $200 order as the live site built it on 2026-09-26 18:00:43 UTC.
function order(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    ticker: "MSFT",
    side: "buy",
    sizeUsd: 200,
    adjustedSpread: -0.0123,
    price: 518.7520441736424,
    recentTicks: Array(12).fill(518.7520441736424),
    expensivePrice: 519.1618644400467,
    expensiveRecentTicks: Array(12).fill(519.1618644400467),
    liquidityDepthUsd: 817039.0576413346,
    simulatedOutputUsd: null,
    poolPair: { cheapPoolAddress: "0xa", cheapPoolFeeUnits: 2500, expensivePoolAddress: "0xb", expensivePoolFeeUnits: 10000 },
    reference: { status: "ok", priceUsd: 519.1033242985989, vendor: "LiquidMesh", route: "Rfq Neptunex" },
    marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
    ...overrides,
  };
}

const byName = (v: ReturnType<typeof check>) => Object.fromEntries(v.checks.map((c) => [c.name, c]));

describe("each check reports its limit and what it measured", () => {
  it("for a passing $200 order", () => {
    const c = byName(check(order(), { spentTodaySoFarUsd: 0 }));
    expect(c.sanityAndLiquidity).toMatchObject({ limit: "each pool within 5% of its recent median (10+ readings); thinner pool ≥ $1,000", measured: "largest deviation 0.00% · thinner pool $817,039" });
    expect(c.marketStatus).toMatchObject({ limit: "TRADING or MARKET_CLOSED", measured: "TRADING" });
    expect(c.referencePrice).toMatchObject({ limit: "within 2% of the Binance quote", measured: "0.07% from $519.10 (LiquidMesh)" });
    expect(c.perTradeCap).toMatchObject({ limit: "≤ $500", measured: "$200" });
    expect(c.dailyCap).toMatchObject({ limit: "≤ $2,000 a day (UTC)", measured: "$0 sent today + $200 = $200" });
    expect(c.dryRunFloor).toMatchObject({ limit: "simulated output ≥ 98% of the order", measured: "not simulated yet" });
  });

  it("follows the config, not fixed text", () => {
    const c = byName(check(order({ sizeUsd: 1000 }), { spentTodaySoFarUsd: 150, config: { ...DEFAULT_GUARDRAIL_CONFIG, perTradeCapUsd: 300, perDayCapUsd: 5000 } }));
    expect(c.perTradeCap).toMatchObject({ ok: false, limit: "≤ $300", measured: "$1,000" });
    expect(c.dailyCap).toMatchObject({ limit: "≤ $5,000 a day (UTC)", measured: "$150 sent today + $1,000 = $1,150" });
  });

  it("during warm-up, sanity reports the readings it has", () => {
    const c = byName(check(order({ recentTicks: [518.75, 518.75, 518.75] }), { spentTodaySoFarUsd: 0 }));
    expect(c.sanityAndLiquidity).toMatchObject({ warmingUp: true, measured: "3 of 10 readings" });
  });

  it("with no Binance quote, and after a simulation", () => {
    const noRef = byName(check(order({ reference: { status: "unavailable", reason: "Binance: timed out" } }), { spentTodaySoFarUsd: 0 }));
    expect(noRef.referencePrice).toMatchObject({ ok: false, measured: "no quote (Binance: timed out)" });
    const sim = byName(check(order({ simulatedOutputUsd: 196.5 }), { spentTodaySoFarUsd: 0 }));
    expect(sim.dryRunFloor).toMatchObject({ measured: "$196.50 (98.3%)" });
  });
});
