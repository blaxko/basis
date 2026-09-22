import { describe, it, expect } from "vitest";
import { narrateProposal } from "./proposal-narrator";
import { check } from "../guardrails/check";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { ProposedOrder } from "../guardrails/check";
import { navEquivalent } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";
import { accruedDividend } from "../data/dividend-calendar";

describe("narrateProposal — MSFT ex-div scenario", () => {
  it("produces the correct advisory line for an approved verdict", () => {
    const symbol = "MSFT";
    const preExDivPrice = 420.0;
    const dividendPerShare = 0.83;
    const exDivDate = "2025-08-21";

    const priceReturnPrice = preExDivPrice - dividendPerShare;
    const ondoPrice = preExDivPrice;
    const accrued = accruedDividend(symbol, exDivDate);
    const navEq = navEquivalent(ondoPrice, accrued);
    const spread = adjustedSpread(navEq, priceReturnPrice);
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

    const verdict = check(order, { spentTodaySoFarUsd: 0, config: DEFAULT_GUARDRAIL_CONFIG });
    expect(verdict.approved).toBe(true);

    const text = narrateProposal({ ticker: symbol, adjustedSpread: spread, proposedSizeUsd: 200 }, verdict);

    expect(text).toBe(
      "MSFT: 0.00% adjusted spread after dividend accrual, no meaningful spread after dividend-adjustment (structural drift correctly suppressed), proposed size $200 — APPROVED (proposed size $200)."
    );
  });

  it("produces a BLOCKED line with the verdict's reason when the gate rejects the order", () => {
    const order: ProposedOrder = {
      ticker: "NVDA",
      side: "buy",
      sizeUsd: 200,
      adjustedSpread: 0.008,
      price: 101,
      recentTicks: [98, 99, 100, 101, 102],
      liquidityDepthUsd: 5000,
      simulatedOutputUsd: 199,
    };

    const verdict = check(order, { spentTodaySoFarUsd: 1900, config: DEFAULT_GUARDRAIL_CONFIG });
    expect(verdict.approved).toBe(false);

    const text = narrateProposal({ ticker: "NVDA", adjustedSpread: 0.008, proposedSizeUsd: 200 }, verdict);

    expect(text).toContain("NVDA: 0.80% adjusted spread");
    expect(text).toContain("price-return leg (xStocks/bStocks) cheap");
    expect(text).toContain(`BLOCKED (${verdict.reason})`);
  });

  it("returns plain text with no order-shaped structure — return type is just string", () => {
    const verdict = check(
      {
        ticker: "AAPL",
        side: "sell",
        sizeUsd: 100,
        adjustedSpread: -0.01,
        price: 200,
        recentTicks: [199, 200, 201],
        liquidityDepthUsd: 5000,
        simulatedOutputUsd: 99,
      },
      { spentTodaySoFarUsd: 0, config: DEFAULT_GUARDRAIL_CONFIG }
    );

    const text = narrateProposal({ ticker: "AAPL", adjustedSpread: -0.01, proposedSizeUsd: 100 }, verdict);

    expect(typeof text).toBe("string");
  });
});
