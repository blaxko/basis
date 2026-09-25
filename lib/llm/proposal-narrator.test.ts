import { describe, it, expect } from "vitest";
import { narrateProposal } from "./proposal-narrator";
import { check } from "../guardrails/check";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { ProposedOrder } from "../guardrails/check";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";

// Synthetic pool identities — poolPair is opaque to narrateProposal()
// (never inspected), so a synthetic value for tests that aren't about a
// specific real pairing is fine. The MSFT test below uses the real
// cheap-pool address instead since it's already citing real prices.
const SYNTHETIC_POOL_PAIR = {
  cheapPoolAddress: "0x1111111111111111111111111111111111111",
  cheapPoolFeeUnits: 2500,
  expensivePoolAddress: "0x2222222222222222222222222222222222222",
  expensivePoolFeeUnits: 10000,
};

// A full warm-up's worth of flat readings (the default minimum is 10).
const tenOf = (price: number) => Array.from({ length: 10 }, () => price);

describe("narrateProposal — real MSFTB cross-pool scenario (declined-trade case)", () => {
  it("produces the correct advisory line for the live pairing that does not clear net", () => {
    // Same live-read numbers as lib/guardrails/check.test.ts's
    // integration test: both real, registered MSFTB pools (0.25% and 1%
    // fee, see lib/data/pool-addresses.ts), read live via a public BSC
    // RPC on 2026-09-24. Re-reading these two pools now will very likely
    // give a different number — see that test's comment for why an
    // earlier "PancakeSwap-vs-Uniswap-V4" pairing was dropped instead of
    // reused here (no verifiable pool address for it).
    const cheapPriceUsd = 496.3821;
    const expensivePriceUsd = 496.9976;

    const effectiveBuyPriceUsd = feeAdjustedPrice(cheapPriceUsd, 2500, "buy");
    const effectiveSellPriceUsd = feeAdjustedPrice(expensivePriceUsd, 10000, "sell");
    const netSpread = adjustedSpread({
      effectiveBuyPriceUsd,
      effectiveSellPriceUsd,
      slippagePct: 0.0005,
      gasCostUsd: 200_000 * 1.5e-9 * 700,
      tradeSizeUsd: 200,
    });
    expect(netSpread).toBeLessThan(0);

    const order: ProposedOrder = {
      ticker: "MSFT",
      side: "buy",
      sizeUsd: 200,
      adjustedSpread: netSpread,
      price: cheapPriceUsd,
      recentTicks: tenOf(cheapPriceUsd),
      expensivePrice: expensivePriceUsd,
      expensiveRecentTicks: tenOf(expensivePriceUsd),
      liquidityDepthUsd: 100_000,
      simulatedOutputUsd: 199,
      // Real Binance quote from docs/devex-log.md (different moment, 0.5% from this pool's spot).
      reference: { status: "ok", priceUsd: 498.8459, vendor: "LiquidMesh", route: "Rfq Neptunex" },
      // Real statusInfo shape, MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
      marketStatus: { status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" },
      poolPair: {
        cheapPoolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea",
        cheapPoolFeeUnits: 2500,
        expensivePoolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44",
        expensivePoolFeeUnits: 10000,
      },
    };

    const verdict = check(order, { spentTodaySoFarUsd: 0, config: DEFAULT_GUARDRAIL_CONFIG });
    expect(verdict.approved).toBe(true); // check() itself doesn't gate on edge sign

    const text = narrateProposal({ ticker: "MSFT", adjustedSpread: netSpread, proposedSizeUsd: 200 }, verdict);

    expect(text).toContain("MSFT: -1.28% net spread after fees/slippage/gas");
    expect(text).toContain("the raw gap does not survive costs");
    expect(text).toContain("APPROVED");
  });

  it("produces a BLOCKED line with the verdict's reason when the gate rejects the order", () => {
    const order: ProposedOrder = {
      ticker: "NVDA",
      side: "buy",
      sizeUsd: 200,
      adjustedSpread: 0.008,
      price: 101,
      recentTicks: tenOf(100),
      expensivePrice: 102,
      expensiveRecentTicks: tenOf(102),
      liquidityDepthUsd: 5000,
      simulatedOutputUsd: 199,
      poolPair: SYNTHETIC_POOL_PAIR,
      reference: { status: "ok", priceUsd: 101.2525, vendor: "LiquidMesh", route: "synthetic" },
      // Real statusInfo shape, MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
      marketStatus: { status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" },
    };

    const verdict = check(order, { spentTodaySoFarUsd: 1900, config: DEFAULT_GUARDRAIL_CONFIG });
    expect(verdict.approved).toBe(false);
    expect(verdict.blockedBy).toBe("dailyCap");

    const text = narrateProposal({ ticker: "NVDA", adjustedSpread: 0.008, proposedSizeUsd: 200 }, verdict);

    expect(text).toContain("NVDA: 0.80% net spread after fees/slippage/gas");
    expect(text).toContain("a real net edge survives costs");
    expect(text).toContain(`BLOCKED (${verdict.reason})`);
  });

  it("describes a negligible net edge as 'no meaningful net edge', not a false positive/negative call", () => {
    const order: ProposedOrder = {
      ticker: "AAPL",
      side: "sell",
      sizeUsd: 100,
      adjustedSpread: 0.0001,
      price: 200,
      recentTicks: tenOf(200),
      expensivePrice: 200.02,
      expensiveRecentTicks: tenOf(200.02),
      liquidityDepthUsd: 5000,
      simulatedOutputUsd: 99,
      poolPair: SYNTHETIC_POOL_PAIR,
      reference: { status: "ok", priceUsd: 200.5, vendor: "LiquidMesh", route: "synthetic" },
      // Real statusInfo shape, MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
      marketStatus: { status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" },
    };

    const verdict = check(order, { spentTodaySoFarUsd: 0, config: DEFAULT_GUARDRAIL_CONFIG });
    const text = narrateProposal({ ticker: "AAPL", adjustedSpread: 0.0001, proposedSizeUsd: 100 }, verdict);

    expect(text).toContain("no meaningful net edge after fees, slippage, and gas");
    expect(typeof text).toBe("string");
  });
});
