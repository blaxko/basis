import { describe, it, expect } from "vitest";
import {
  check,
  sanityAndLiquidityCheck,
  perTradeCapCheck,
  dailyCapCheck,
  dryRunFloorCheck,
  type ProposedOrder,
} from "./check";
import { DEFAULT_GUARDRAIL_CONFIG } from "./config";
import { navEquivalent } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";
import { accruedDividend } from "../data/dividend-calendar";

const config = DEFAULT_GUARDRAIL_CONFIG;

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

describe("integration: MSFT ex-div scenario clears the gate", () => {
  it("composes with the Basis Model's adjusted spread to approve a small, in-bounds order", () => {
    const symbol = "MSFT";
    const preExDivPrice = 420.0;
    const dividendPerShare = 0.83;
    const exDivDate = "2025-08-21";

    const priceReturnPrice = preExDivPrice - dividendPerShare;
    const ondoPrice = preExDivPrice;

    const accrued = accruedDividend(symbol, exDivDate);
    const navEq = navEquivalent(ondoPrice, accrued);
    const spread = adjustedSpread(navEq, priceReturnPrice);

    // The correctly-adjusted spread is ~zero, not the ~0.2% a naive raw
    // diff would report — confirming this order is what the Basis Model
    // would actually hand off, not a synthetic shortcut.
    expect(Math.abs(spread)).toBeLessThan(0.0005);

    const order: ProposedOrder = {
      ticker: symbol,
      side: "buy",
      sizeUsd: 200,
      adjustedSpread: spread,
      price: priceReturnPrice,
      recentTicks: [preExDivPrice - dividendPerShare - 1, preExDivPrice - dividendPerShare, priceReturnPrice],
      liquidityDepthUsd: 5000,
      simulatedOutputUsd: 199,
    };

    const verdict = check(order, { spentTodaySoFarUsd: 0, config });

    expect(verdict.approved).toBe(true);
    expect(verdict.approvedSizeUsd).toBe(200);
  });
});
