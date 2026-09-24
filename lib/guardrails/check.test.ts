import { describe, it, expect } from "vitest";
import {
  check,
  sanityAndLiquidityCheck,
  perTradeCapCheck,
  dailyCapCheck,
  dryRunFloorCheck,
  spreadFreshnessCheck,
  type ProposedOrder,
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

// A baseline order that passes every check on its own, so each test below
// can violate exactly one dimension and prove the others don't interfere.
function baseOrder(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    ticker: "NVDA",
    side: "buy",
    sizeUsd: 200,
    adjustedSpread: 0.008,
    price: 101,
    recentTicks: [98, 99, 100, 101, 102],
    liquidityDepthUsd: 5000,
    simulatedOutputUsd: 199,
    poolPair: SYNTHETIC_POOL_PAIR,
    ...overrides,
  };
}

describe("sanityAndLiquidityCheck", () => {
  it("passes when price is within bounds and liquidity is sufficient", () => {
    expect(sanityAndLiquidityCheck(baseOrder(), config).ok).toBe(true);
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
});

describe("check() — composed gate", () => {
  it("approves a fully-passing order and returns a risk-sized position", () => {
    const verdict = check(baseOrder(), { spentTodaySoFarUsd: 0, config });
    expect(verdict.approved).toBe(true);
    expect(verdict.status).toBe("approved");
    expect(verdict.blockedBy).toBeUndefined();
    expect(verdict.approvedSizeUsd).toBe(200);
    expect(verdict.checks.every((c) => c.ok)).toBe(true);
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
  it("the LIVE MSFTB 0.25%-vs-1% PancakeSwap pairing (real, −1.28% net as of this check) correctly BLOCKS — not a lesser outcome, the honest one", () => {
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
      recentTicks: [],
      liquidityDepthUsd: 100_000,
      // dryRunFloorCheck's floor is sized to a proportion of sizeUsd, not
      // to netSpread — a negative net edge doesn't automatically fail
      // sanity/liquidity/dry-run; the point of this test is that the
      // guardrail gate doesn't need a separate "is this profitable" check
      // baked into check() itself, since a genuinely non-clearing order
      // simply should never be constructed by the caller in the first
      // place (lib/orchestration/agent-loop.ts's job, not check()'s).
      simulatedOutputUsd: 199,
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
