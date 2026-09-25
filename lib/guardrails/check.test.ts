import { describe, it, expect } from "vitest";
import {
  check,
  sanityAndLiquidityCheck,
  perTradeCapCheck,
  dailyCapCheck,
  dryRunFloorCheck,
  spreadFreshnessCheck,
  slippageToleranceCheck,
  referencePriceCheck,
  marketStatusCheck,
  MARKET_STATUS_BLOCK_CODES,
  type ProposedOrder,
  type MarketStatus,
} from "./check";
import { DEFAULT_GUARDRAIL_CONFIG } from "./config";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";

const config = DEFAULT_GUARDRAIL_CONFIG;

// Placeholder pool identities — NVDA has no confirmed real pool addresses
// this session (only MSFTB does, see lib/data/pool-addresses.ts), so
// these named checks/composition tests use synthetic addresses. poolPair
// is opaque to check() itself (never inspected by any of the four named
// checks), so a synthetic value doesn't weaken what these tests prove.
const SYNTHETIC_POOL_PAIR = {
  cheapPoolAddress: "0x1111111111111111111111111111111111111",
  cheapPoolFeeUnits: 2500,
  expensivePoolAddress: "0x2222222222222222222222222222222222222",
  expensivePoolFeeUnits: 10000,
};

// Exactly the default minimum of 10 readings per pool, gently varying.
const CHEAP_HISTORY = [98, 99, 100, 101, 102, 100, 99, 101, 100, 100];
const EXPENSIVE_HISTORY = [101, 102, 103, 102, 101, 102, 103, 102, 102, 102];

// A baseline order that passes every check on its own, so each test below
// can violate exactly one dimension and prove the others don't interfere.
function baseOrder(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    ticker: "NVDA",
    side: "buy",
    sizeUsd: 200,
    adjustedSpread: 0.008,
    price: 101,
    recentTicks: CHEAP_HISTORY,
    expensivePrice: 102,
    expensiveRecentTicks: EXPENSIVE_HISTORY,
    liquidityDepthUsd: 5000,
    simulatedOutputUsd: 199,
    poolPair: SYNTHETIC_POOL_PAIR,
    // 0.25% above the cheap pool's spot price, well inside the 2% limit.
    reference: { status: "ok", priceUsd: 101.2525, vendor: "LiquidMesh", route: "synthetic" },
    // Real statusInfo shape, MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
    marketStatus: { status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" },
    ...overrides,
  };
}

// statusInfo as the RWA Data API returns it; defaults to the real MSFTB
// response of 2026-09-25 12:06 UTC.
function status(overrides: Partial<Extract<MarketStatus, { status: "ok" }>> = {}): MarketStatus {
  return {
    status: "ok",
    openState: true,
    reasonCode: "TRADING",
    marketStatus: null,
    reasonMsg: null,
    nextOpenTime: null,
    nextCloseTime: null,
    fetchedAt: "2026-09-25T12:06:16.554Z",
    ...overrides,
  };
}

describe("marketStatusCheck", () => {
  it("passes on TRADING (the real MSFTB response)", () => {
    expect(marketStatusCheck(baseOrder({ marketStatus: status() }))).toEqual({ name: "marketStatus", ok: true });
  });

  it("passes on MARKET_CLOSED — trading through the underlying's closed hours is the premise", () => {
    const closed = status({ openState: false, reasonCode: "MARKET_CLOSED", marketStatus: "closed", reasonMsg: "Weekend or Holiday", nextOpenTime: 1790596200000 });
    expect(marketStatusCheck(baseOrder({ marketStatus: closed })).ok).toBe(true);
    expect(check(baseOrder({ marketStatus: closed }), { spentTodaySoFarUsd: 0, config }).approved).toBe(true);
  });

  it("passes on openState true with no reasonCode (documented as returned only when openState=false)", () => {
    expect(marketStatusCheck(baseOrder({ marketStatus: status({ reasonCode: null }) })).ok).toBe(true);
  });

  it.each(["ASSET_PAUSED", "ASSET_LIMITED", "UNSUPPORTED", "MARKET_MAINTENANCE", "MARKET_PAUSED"])("blocks on %s", (code) => {
    expect(MARKET_STATUS_BLOCK_CODES).toContain(code);
    const order = baseOrder({ marketStatus: status({ openState: false, reasonCode: code, reasonMsg: "stock_split" }) });
    const result = marketStatusCheck(order);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(`underlying market status ${code} (Binance: "stock_split")`);
    const verdict = check(order, { spentTodaySoFarUsd: 0, config });
    expect(verdict.approved).toBe(false);
    expect(verdict.blockedBy).toBe("marketStatus");
  });

  it("blocks — fails closed — when the status couldn't be fetched", () => {
    const order = baseOrder({
      marketStatus: { status: "unavailable", reason: "code 40304: Service not available due to compliance restriction", fetchedAt: "2026-09-25T11:46:40.393Z" },
    });
    expect(marketStatusCheck(order)).toEqual({
      name: "marketStatus",
      ok: false,
      reason: "underlying market status unavailable: code 40304: Service not available due to compliance restriction",
    });
    expect(check(order, { spentTodaySoFarUsd: 0, config }).blockedBy).toBe("marketStatus");
  });

  it("blocks on a reasonCode outside the documented enum, and on openState false with no code", () => {
    expect(marketStatusCheck(baseOrder({ marketStatus: status({ reasonCode: "HALTED_NEW_CODE" }) })).reason).toContain("unrecognized");
    expect(marketStatusCheck(baseOrder({ marketStatus: status({ openState: false, reasonCode: null }) })).reason).toContain("unrecognized");
  });

  it("decides on reasonCode only — free-text reasonMsg and marketStatus never change the outcome", () => {
    expect(marketStatusCheck(baseOrder({ marketStatus: status({ reasonMsg: "trading halt", marketStatus: "pause" }) })).ok).toBe(true);
    expect(
      marketStatusCheck(baseOrder({ marketStatus: status({ openState: false, reasonCode: "ASSET_PAUSED", reasonMsg: "normal trading", marketStatus: "regular" }) })).ok
    ).toBe(false);
  });
});

describe("sanityAndLiquidityCheck", () => {
  it("passes on normal history with enough readings for both pools", () => {
    const result = sanityAndLiquidityCheck(baseOrder(), config);
    expect(result.ok).toBe(true);
    expect(result.warmingUp).toBeUndefined();
  });

  it("blocks a price spike on the cheap pool", () => {
    const result = sanityAndLiquidityCheck(baseOrder({ price: 120 }), config);
    expect(result.ok).toBe(false);
    expect(result.warmingUp).toBeUndefined();
    expect(result.reason).toContain("cheap pool");
    expect(result.reason).toContain("deviates");
  });

  it("blocks a price spike on the expensive pool — a bad reading there can fake an edge too", () => {
    const result = sanityAndLiquidityCheck(baseOrder({ expensivePrice: 120 }), config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expensive pool");
  });

  it("blocks during warm-up, flagged as warming up rather than bad data", () => {
    const result = sanityAndLiquidityCheck(baseOrder({ recentTicks: CHEAP_HISTORY.slice(0, 9) }), config);
    expect(result.ok).toBe(false);
    expect(result.warmingUp).toBe(true);
    expect(result.reason).toContain("warming up: 9 of 10");
  });

  it("blocks during warm-up when only the expensive pool's history is short", () => {
    const result = sanityAndLiquidityCheck(baseOrder({ expensiveRecentTicks: [] }), config);
    expect(result.ok).toBe(false);
    expect(result.warmingUp).toBe(true);
    expect(result.reason).toContain("expensive pool: warming up: 0 of 10");
  });

  it("blocks when price deviates far from recent history", () => {
    const result = sanityAndLiquidityCheck(baseOrder({ price: 99999 }), config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("blocks when liquidity depth is below the minimum", () => {
    const result = sanityAndLiquidityCheck(baseOrder({ liquidityDepthUsd: 10 }), config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe("referencePriceCheck", () => {
  it("passes when the buy-leg pool's spot price is within the limit of the Binance reference", () => {
    // 101 vs 101.5: 0.49% apart.
    const result = referencePriceCheck(baseOrder({ reference: { status: "ok", priceUsd: 101.5, vendor: "LiquidMesh", route: "x" } }), config);
    expect(result.ok).toBe(true);
  });

  it("compares spot, not fee-inclusive: a 1% pool's own fee isn't counted as a data error", () => {
    // Against 99.2: spot 101 is 1.81% off (a pass); spot × 1.01 would be 2.83% off (a block).
    const order = baseOrder({
      poolPair: { ...SYNTHETIC_POOL_PAIR, cheapPoolFeeUnits: 10000 },
      reference: { status: "ok", priceUsd: 99.2, vendor: "v", route: "x" },
    });
    expect(Math.abs(101 * 1.01 - 99.2) / 99.2).toBeGreaterThan(config.maxReferenceDivergencePct);
    expect(referencePriceCheck(order, config).ok).toBe(true);
  });

  it("passes on the real same-moment reading (2026-09-25): 1% pool $497.0062 vs Binance $497.6310", () => {
    const order = baseOrder({ price: 497.0062, reference: { status: "ok", priceUsd: 497.631, vendor: "LiquidMesh", route: "Rfq Neptune" } });
    expect(referencePriceCheck(order, config).ok).toBe(true);
  });

  it("blocks when the pool price diverges from the reference beyond the limit", () => {
    const result = referencePriceCheck(baseOrder({ reference: { status: "ok", priceUsd: 110, vendor: "LiquidMesh", route: "x" } }), config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("buy-leg pool price $101.0000 is 8.18% from the Binance reference $110.0000 (LiquidMesh)");
    expect(result.reason).toContain("over the 2.00% limit");
  });

  it("blocks when the reference is unavailable — no reference, no trade", () => {
    const result = referencePriceCheck(baseOrder({ reference: { status: "unavailable", reason: "HTTP 503" } }), config);
    expect(result.ok).toBe(false);
    expect(result.pending).toBeUndefined();
    expect(result.reason).toBe("no Binance reference quote: HTTP 503");
  });

  it("check() blocks on it, and shows it on the verdict, when every other check passes", () => {
    const verdict = check(baseOrder({ reference: { status: "unavailable", reason: "getaddrinfo ENOTFOUND web3.binance.com" } }), {
      spentTodaySoFarUsd: 0,
      config,
    });
    expect(verdict.approved).toBe(false);
    expect(verdict.blockedBy).toBe("referencePrice");
    expect(verdict.checks.map((c) => c.name)).toContain("referencePrice");
  });
});

describe("perTradeCapCheck", () => {
  it("passes when order size is within the per-trade cap", () => {
    expect(perTradeCapCheck(baseOrder({ sizeUsd: 500 }), config).ok).toBe(true);
  });

  it("blocks when order size exceeds the per-trade cap", () => {
    const result = perTradeCapCheck(baseOrder({ sizeUsd: 501 }), config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("per-trade cap");
  });
});

describe("dailyCapCheck", () => {
  it("passes when projected daily spend is within the daily cap", () => {
    const result = dailyCapCheck(baseOrder({ sizeUsd: 200 }), { spentTodaySoFarUsd: 1000 }, config);
    expect(result.ok).toBe(true);
  });

  it("blocks when projected daily spend exceeds the daily cap", () => {
    const result = dailyCapCheck(baseOrder({ sizeUsd: 200 }), { spentTodaySoFarUsd: 1900 }, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("daily cap");
  });
});

describe("dryRunFloorCheck", () => {
  it("passes when simulated output clears the floor", () => {
    const result = dryRunFloorCheck(baseOrder({ sizeUsd: 200, simulatedOutputUsd: 199 }), config);
    expect(result.ok).toBe(true);
  });

  it("blocks when simulated output falls below the floor", () => {
    const result = dryRunFloorCheck(baseOrder({ sizeUsd: 200, simulatedOutputUsd: 100 }), config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("floor");
  });

  it("is pending — not passed — when no simulation has run yet", () => {
    const result = dryRunFloorCheck(baseOrder({ simulatedOutputUsd: null }), config);
    expect(result.pending).toBe(true);
    expect(result.ok).toBe(true); // doesn't block; the pipeline re-runs it on the real output
    expect(result.reason).toContain("no simulation yet");
  });
});

describe("slippageToleranceCheck", () => {
  it("passes when the tolerance is strictly below the net edge", () => {
    expect(slippageToleranceCheck(0.006, config).ok).toBe(true);
  });

  it("fails closed when the tolerance equals the net edge", () => {
    const result = slippageToleranceCheck(config.sendSlippageTolerance, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("is not below the net edge");
  });

  it("fails closed when the tolerance exceeds the net edge", () => {
    expect(slippageToleranceCheck(0.0001, config).ok).toBe(false);
  });

  it("default tolerance is well below the 1% it replaced", () => {
    expect(config.sendSlippageTolerance).toBeLessThan(0.01);
  });
});

describe("check() — composed gate", () => {
  it("approves a fully-passing order and returns a risk-sized position", () => {
    const verdict = check(baseOrder(), { spentTodaySoFarUsd: 0, config });
    expect(verdict.approved).toBe(true);
    expect(verdict.status).toBe("approved");
    expect(verdict.blockedBy).toBeUndefined();
    expect(verdict.approvedSizeUsd).toBe(200);
    expect(verdict.checks.every((c) => c.ok)).toBe(true);
    expect(verdict.reason).toBe("all guardrail checks passed");
  });

  it("an order built before simulation is approved with the floor pending, and says so", () => {
    const verdict = check(baseOrder({ simulatedOutputUsd: null }), { spentTodaySoFarUsd: 0, config });
    expect(verdict.approved).toBe(true);
    expect(verdict.checks.find((c) => c.name === "dryRunFloor")?.pending).toBe(true);
    expect(verdict.reason).toContain("pending until simulation: dryRunFloor");
  });

  it("never approves on empty price history — blocks as warming up", () => {
    const verdict = check(baseOrder({ recentTicks: [], expensiveRecentTicks: [] }), { spentTodaySoFarUsd: 0, config });
    expect(verdict.approved).toBe(false);
    expect(verdict.blockedBy).toBe("sanityAndLiquidity");
    expect(verdict.checks.find((c) => c.name === "sanityAndLiquidity")?.warmingUp).toBe(true);
  });

  it("no check is ever reported as a plain pass without data: every ok check is either backed by input or marked pending", () => {
    const verdict = check(baseOrder({ simulatedOutputUsd: null }), { spentTodaySoFarUsd: 0, config });
    const plainPasses = verdict.checks.filter((c) => c.ok && !c.pending).map((c) => c.name);
    expect(plainPasses).toEqual(["sanityAndLiquidity", "marketStatus", "referencePrice", "perTradeCap", "dailyCap"]);
  });

  it("blocks on the daily cap alone when every other check would pass", () => {
    const order = baseOrder({ sizeUsd: 200 });
    const verdict = check(order, { spentTodaySoFarUsd: 1900, config });

    expect(verdict.approved).toBe(false);
    expect(verdict.status).toBe("blocked");
    expect(verdict.blockedBy).toBe("dailyCap");
    expect(verdict.reason).toContain("daily cap");
    expect(verdict.approvedSizeUsd).toBeUndefined();

    const otherChecks = verdict.checks.filter((c) => c.name !== "dailyCap");
    expect(otherChecks.every((c) => c.ok)).toBe(true);
    const dailyCheck = verdict.checks.find((c) => c.name === "dailyCap");
    expect(dailyCheck?.ok).toBe(false);
  });

  it("blocks on the per-trade cap alone when every other check would pass", () => {
    const order = baseOrder({ sizeUsd: 600, simulatedOutputUsd: 599 });
    const verdict = check(order, { spentTodaySoFarUsd: 0, config });

    expect(verdict.approved).toBe(false);
    expect(verdict.status).toBe("blocked");
    expect(verdict.blockedBy).toBe("perTradeCap");
    expect(verdict.reason).toContain("per-trade cap");
  });

  it("blocks on the dry-run floor alone when every other check would pass", () => {
    const order = baseOrder({ sizeUsd: 200, simulatedOutputUsd: 50 });
    const verdict = check(order, { spentTodaySoFarUsd: 0, config });

    expect(verdict.approved).toBe(false);
    expect(verdict.status).toBe("blocked");
    expect(verdict.blockedBy).toBe("dryRunFloor");
    expect(verdict.reason).toContain("floor");
  });

  it("blocks on sanity/liquidity alone when every other check would pass", () => {
    const order = baseOrder({ liquidityDepthUsd: 1 });
    const verdict = check(order, { spentTodaySoFarUsd: 0, config });

    expect(verdict.approved).toBe(false);
    expect(verdict.status).toBe("blocked");
    expect(verdict.blockedBy).toBe("sanityAndLiquidity");
    expect(verdict.checks[0]?.name).toBe("sanityAndLiquidity");
    expect(verdict.checks[0]?.ok).toBe(false);
  });

  it("fails closed on malformed input instead of silently approving", () => {
    // Simulates a caller bypassing the type system (e.g. deserialized
    // JSON with a corrupted field) rather than a genuine limit violation.
    const malformed = { ...baseOrder(), recentTicks: null } as unknown as ProposedOrder;
    const verdict = check(malformed, { spentTodaySoFarUsd: 0, config });

    expect(verdict.approved).toBe(false);
    expect(verdict.status).toBe("error");
    expect(verdict.blockedBy).toBeUndefined();
    expect(verdict.reason).toContain("internal error");
  });

  it("every verdict carries enough structure for an audit-ledger append", () => {
    const verdict = check(baseOrder(), { spentTodaySoFarUsd: 0, config });
    expect(verdict.timestamp).toBeGreaterThan(0);
    expect(verdict.input).toBeDefined();
    expect(Array.isArray(verdict.checks)).toBe(true);
  });
});

describe("integration: real MSFTB cross-pool pairing composes with check()", () => {
  it("the LIVE MSFTB 0.25%-vs-1% PancakeSwap pairing (−1.28% net as of this read) flows through check() cleanly — check() doesn't gate on sign; the pipeline's no_edge gate declines it", () => {
    // Prices from a LIVE on-chain read (public BSC RPC, both real
    // registered pools — see lib/data/pool-addresses.ts) performed
    // 2026-09-24: 0.25% pool $496.3821, 1% pool $496.9976. This is the
    // only pairing in this codebase with a live-reproducible number —
    // read it again any time via readPoolPrice() against these same two
    // addresses to get a current figure (it will differ; real BSC pool
    // prices move — see demo-history.ts's own note on 0.3-1.6% intrahour
    // volatility for this exact pool set).
    //
    // An earlier version of this test used a "PancakeSwap-vs-Uniswap-V4"
    // pairing at −0.145% net. It has been dropped as unverifiable, not
    // disproven: no pool identifier for it was ever saved in this
    // codebase, and a DEXScreener pair search for MSFTB on BSC
    // (2026-09-24) returned no Uniswap MSFTB/USDT pair to re-read.
    // CoinGecko does list a "Uniswap V4 (BSC)" MSFTB/USDT venue, so the
    // pool may exist. Until it is re-found and re-read live, that figure
    // is not a known/verified pairing.
    const cheapPriceUsd = 496.3821;
    const expensivePriceUsd = 496.9976;

    const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPriceUsd, 2500, "buy");
    const effectiveSellPriceUsd = feeAdjustedPrice(expensivePriceUsd, 10000, "sell");
    // The −1.28% figure was computed with the old flat $0.21 gas; kept
    // here so the documented number stays reproducible.
    const gasCostUsd = 200_000 * 1.5e-9 * 700;
    const netSpread = adjustedSpread({
      effectiveBuyPriceUsd,
      effectiveSellPriceUsd,
      slippagePct: 0.0005,
      gasCostUsd,
      tradeSizeUsd: 200,
    });
    expect(netSpread).toBeLessThan(0);

    const order: ProposedOrder = {
      ticker: "MSFT",
      side: "buy",
      sizeUsd: 200,
      adjustedSpread: netSpread,
      price: cheapPriceUsd,
      recentTicks: Array.from({ length: 10 }, () => cheapPriceUsd),
      expensivePrice: expensivePriceUsd,
      expensiveRecentTicks: Array.from({ length: 10 }, () => expensivePriceUsd),
      liquidityDepthUsd: 100_000,
      // dryRunFloorCheck's floor is sized to a proportion of sizeUsd, not
      // to netSpread — a negative net edge doesn't automatically fail
      // sanity/liquidity/dry-run; the point of this test is that the
      // guardrail gate doesn't need a separate "is this profitable" check
      // baked into check() itself, since a genuinely non-clearing order
      // simply should never be constructed by the caller in the first
      // place (lib/orchestration/agent-loop.ts's job, not check()'s).
      simulatedOutputUsd: 199,
      // The real Binance aggregator quote from docs/devex-log.md (10 USDT,
      // 2026-09-24 21:32 UTC) — a different moment from the pool reads
      // above, so this shows a realistic divergence, not a same-instant one.
      reference: { status: "ok", priceUsd: 498.8459, vendor: "LiquidMesh", route: "Rfq Neptunex" },
      // Real statusInfo shape, MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
      marketStatus: { status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" },
      // Both real, registered MSFTB pools (see lib/data/pool-addresses.ts).
      poolPair: {
        cheapPoolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea",
        cheapPoolFeeUnits: 2500,
        expensivePoolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44",
        expensivePoolFeeUnits: 10000,
      },
    };

    const verdict = check(order, { spentTodaySoFarUsd: 0, config });

    // check() itself has no "is the spread positive" gate — that's
    // agent-loop.ts's threshold filter, upstream of ever constructing an
    // order. What this integration test actually proves: the real
    // negative-net-edge number flows cleanly through the Basis Model and
    // into a ProposedOrder without the guardrail gate choking on it.
    expect(verdict.approved).toBe(true);
    expect(order.adjustedSpread).toBeCloseTo(-0.0128, 3);
  });
});

describe("spreadFreshnessCheck", () => {
  it("passes when the fresh spread fully retains the detected spread", () => {
    const result = spreadFreshnessCheck(0.01, 0.01, config);
    expect(result.ok).toBe(true);
  });

  it("passes when the fresh spread retains exactly the configured floor", () => {
    const result = spreadFreshnessCheck(0.01, 0.005, config); // exactly 50% retention
    expect(result.ok).toBe(true);
  });

  it("blocks when the fresh spread has decayed below the retention floor", () => {
    const result = spreadFreshnessCheck(0.01, 0.003, config); // 30% retention, floor is 50%
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("retention floor");
  });

  it("blocks when the fresh spread has inverted to negative, even if the ratio math would look small", () => {
    const result = spreadFreshnessCheck(0.01, -0.002, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no longer positive");
  });

  it("blocks when the fresh spread is exactly zero", () => {
    const result = spreadFreshnessCheck(0.01, 0, config);
    expect(result.ok).toBe(false);
  });
});
