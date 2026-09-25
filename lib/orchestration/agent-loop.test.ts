import { describe, it, expect, vi } from "vitest";
import {
  runAgentLoop,
  computeSpreads,
  previewOpportunities,
  DEFAULT_AGENT_LOOP_CONFIG,
  type AgentLoopConfig,
  type EstimateGasFn,
  type FetchReferenceFn,
  type FetchMarketStatusFn,
} from "./agent-loop";
import { DailySpendTracker } from "./spend-tracker";
import { AuditLedger, defaultLedger } from "../execution/audit-ledger";
import { BoundedPriceHistory } from "../data/price-history";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";
import type { PoolQuote } from "../data/types";
import type { WalletClient, FreshPoolPrices } from "../execution/pipeline";

const STABLECOIN = "0x55d398326f99059fF775485246999027B3197955" as const;
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" as const; // real MSFTB address
const POOL_025 = "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea";
const POOL_1 = "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44";

// LIVE: both real registered MSFTB pools, read via a public BSC RPC on
// 2026-09-24 — 0.25% pool $496.3821, 1% pool $496.9976. Net of fees,
// slippage, and the old flat $0.21 gas, this is about -1.28%. Re-reading
// the pools now will give a different number.
const LIVE_CHEAP = 496.3821;
const LIVE_EXPENSIVE = 496.9976;

// SYNTHETIC: made-up prices on the same real pools, chosen to give a
// positive net edge (~+0.61%) so the order-building path can be tested.
// Not a reading of anything.
const SYNTHETIC_CHEAP = 490;
const SYNTHETIC_EXPENSIVE = 500;

// Gas pinned to the old flat $0.21 so the documented figures above stay
// reproducible; the live estimator has its own tests.
const pinnedGas: EstimateGasFn = async () => ({ gasCostUsd: 200_000 * 1.5e-9 * 700, source: "fallback" });

function poolQuotes(cheapPriceUsd: number, expensivePriceUsd: number): PoolQuote[] {
  const timestamp = Date.now();
  return [
    { ticker: "MSFT", poolAddress: POOL_025, feeUnits: 2500, priceUsd: cheapPriceUsd, liquidityUsdEstimate: 50_000, timestamp },
    { ticker: "MSFT", poolAddress: POOL_1, feeUnits: 10000, priceUsd: expensivePriceUsd, liquidityUsdEstimate: 50_000, timestamp },
  ];
}

function freshPrices(cheapPriceUsd: number, expensivePriceUsd: number): () => Promise<FreshPoolPrices> {
  return () =>
    Promise.resolve({
      cheapPoolPriceUsd: cheapPriceUsd,
      cheapPoolToken0: STABLECOIN,
      cheapPoolToken1: MSFTB,
      expensivePoolPriceUsd: expensivePriceUsd,
      expensivePoolToken0: STABLECOIN,
      expensivePoolToken1: MSFTB,
    });
}

// A history with `count` readings per pool at the given prices.
function historyWith(count: number, cheap: number, expensive: number): BoundedPriceHistory {
  const history = new BoundedPriceHistory();
  for (let i = 0; i < count; i++) {
    history.record(POOL_025, cheap);
    history.record(POOL_1, expensive);
  }
  return history;
}

const warmHistory = () => historyWith(10, SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE);

// Bypasses unset TRADING_WALLET_PRIVATE_KEY/BSC_RPC_URL credentials.
const getWalletAddress = () => "0x1234567890123456789012345678901234567890";

function mockWalletClient(): WalletClient {
  return {
    checkAllowance: vi.fn().mockResolvedValue({ sufficient: true, currentAllowance: 10n ** 30n }),
    simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
    simulateWithBinance: vi.fn().mockResolvedValue({ result: "succeeded", status: "SUCCESS", balanceChanges: [], allowanceChanges: [] }),
  };
}

const CONFIG: AgentLoopConfig = {
  underlyings: ["MSFT"],
  adjustedSpreadThreshold: 0.0001,
  orderSizeUsd: 200,
  gasSafetyMultiplier: 2,
  fallbackGasCostUsd: 200_000 * 1.5e-9 * 700,
  slippagePctEstimate: 0.0005,
};

// A Binance reference 0.25% above the cheap pool's spot price — well
// inside the 2% limit, so it isn't what these tests are about.
function agreeingReference(cheap: number): FetchReferenceFn {
  return vi.fn(async () => ({ status: "ok" as const, priceUsd: cheap * 1.0025, vendor: "LiquidMesh", route: "stub" }));
}

// The real statusInfo shape for MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
function tradingStatus(): FetchMarketStatusFn {
  return vi.fn(async () => ({ status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" }));
}

function loopDeps(cheap: number, expensive: number, overrides: Record<string, unknown> = {}) {
  return {
    spendTracker: new DailySpendTracker(),
    getMode: () => "dry-run" as const,
    ledger: new AuditLedger(),
    walletClient: mockWalletClient(),
    agentConfig: CONFIG,
    fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(cheap, expensive)),
    estimateGasFn: pinnedGas,
    fetchReferenceFn: agreeingReference(cheap),
    fetchMarketStatusFn: tradingStatus(),
    priceHistory: warmHistory(),
    fetchFreshPoolPrices: freshPrices(cheap, expensive),
    getWalletAddress,
    ...overrides,
  };
}

describe("runAgentLoop — a negative net edge is a detection decision, not an order", () => {
  it("live -1.28% edge: zero orders, exactly one no_opportunity entry carrying both pool prices, gross gap, net edge, and gas", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();
    const fetchFreshPoolPrices = vi.fn(freshPrices(LIVE_CHEAP, LIVE_EXPENSIVE));

    const result = await runAgentLoop(
      loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { getMode: () => "live", ledger, walletClient, fetchFreshPoolPrices })
    );

    expect(result.triggered).toHaveLength(0);
    expect(result.noOpportunities).toHaveLength(1);

    const entries = ledger.readAll();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("detection");
    expect(entry.outcome).toBe("no_opportunity");
    expect("verdict" in entry).toBe(false); // check() never ran — not a guardrail decision
    if (entry.kind !== "detection") throw new Error("unreachable");
    expect(entry.detection.cheapPool).toEqual({ address: POOL_025, feeUnits: 2500, priceUsd: LIVE_CHEAP });
    expect(entry.detection.expensivePool).toEqual({ address: POOL_1, feeUnits: 10000, priceUsd: LIVE_EXPENSIVE });
    expect(entry.detection.grossGap).toBeCloseTo(0.00124, 5);
    expect(entry.detection.netEdge).toBeCloseTo(-0.0128, 3);
    expect(entry.detection.gas).toEqual({ costUsd: 0.21, source: "fallback" });

    expect(fetchFreshPoolPrices).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("a negative threshold can't turn a negative edge into an order", async () => {
    const ledger = new AuditLedger();
    const result = await runAgentLoop(
      loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { ledger, agentConfig: { ...CONFIG, adjustedSpreadThreshold: -1 } })
    );

    expect(result.triggered).toHaveLength(0);
    expect(ledger.readAll().map((e) => e.outcome)).toEqual(["no_opportunity"]);
  });

  it("a positive edge that doesn't exceed the threshold is also no_opportunity", async () => {
    const ledger = new AuditLedger();
    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { ledger, agentConfig: { ...CONFIG, adjustedSpreadThreshold: 0.01 } })
    );

    expect(result.triggered).toHaveLength(0);
    expect(result.noOpportunities[0]!.netEdge).toBeGreaterThan(0);
    expect(ledger.readAll().map((e) => e.outcome)).toEqual(["no_opportunity"]);
  });
});

describe("runAgentLoop — price-history warm-up", () => {
  it("a clearing edge during warm-up proposes no order: one warming_up detection entry, pipeline untouched", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();
    const fetchFreshPoolPrices = vi.fn(freshPrices(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE));

    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, {
        ledger,
        walletClient,
        fetchFreshPoolPrices,
        priceHistory: historyWith(4, SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE),
      })
    );

    expect(result.triggered).toHaveLength(0);
    expect(result.warmingUp).toEqual([expect.objectContaining({ ticker: "MSFT", readings: 4, required: 10, complete: false })]);
    const entry = ledger.readAll()[0]!;
    expect(entry.kind).toBe("detection");
    expect(entry.outcome).toBe("warming_up");
    if (entry.kind !== "detection") throw new Error("unreachable");
    expect(entry.warmUp).toEqual({ readings: 4, required: 10 });
    expect(fetchFreshPoolPrices).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("counts the shorter of the two pools' histories", async () => {
    const lopsided = new BoundedPriceHistory();
    for (let i = 0; i < 10; i++) lopsided.record(POOL_025, SYNTHETIC_CHEAP);
    for (let i = 0; i < 3; i++) lopsided.record(POOL_1, SYNTHETIC_EXPENSIVE);

    const result = await runAgentLoop(loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { priceHistory: lopsided }));
    expect(result.warmingUp[0]).toEqual(expect.objectContaining({ readings: 3 }));
  });

  it("records each pool's reading after evaluating it — a price is never judged against itself", async () => {
    const history = historyWith(9, SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE);

    const first = await runAgentLoop(loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { priceHistory: history }));
    expect(first.warmingUp).toHaveLength(1); // 9 readings before this tick
    expect(history.recent(POOL_025)).toHaveLength(10);

    const second = await runAgentLoop(loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { priceHistory: history }));
    expect(second.warmingUp).toHaveLength(0);
    expect(second.triggered).toHaveLength(1); // warm-up complete on the 11th tick
  });

  it("records readings even when the evaluation is a no_opportunity", async () => {
    const history = new BoundedPriceHistory();
    await runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { priceHistory: history }));
    expect(history.recent(POOL_025)).toEqual([LIVE_CHEAP]);
    expect(history.recent(POOL_1)).toEqual([LIVE_EXPENSIVE]);
  });

  it("a price spike on a warmed-up pool is blocked by the guardrail, not traded", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();
    // History says the expensive pool sits at $500; this tick reads $560.
    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, 560, { ledger, walletClient, priceHistory: warmHistory() })
    );

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]!.outcome).toBe("blocked");
    expect(result.triggered[0]!.verdict.reason).toContain("expensive pool");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });
});

describe("runAgentLoop — a positive net edge above threshold, after warm-up, produces an order", () => {
  it("builds an order with both pools' history, runs it through the pipeline, and the entry carries the detection snapshot", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();

    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { ledger, walletClient, guardrailConfig: DEFAULT_GUARDRAIL_CONFIG })
    );

    expect(result.noOpportunities).toHaveLength(0);
    expect(result.triggered).toHaveLength(1);
    const opportunity = result.triggered[0]!;
    expect(opportunity.order.recentTicks).toHaveLength(10);
    expect(opportunity.order.expensiveRecentTicks).toHaveLength(10);
    expect(opportunity.order.expensivePrice).toBe(SYNTHETIC_EXPENSIVE);
    expect(opportunity.order.simulatedOutputUsd).toBeNull();
    expect(opportunity.outcome).toBe("dry_run_only");
    expect(walletClient.simulateSwap).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();

    const entry = ledger.readAll()[0]!;
    expect(entry.kind).toBe("pipeline");
    expect(entry.kind === "pipeline" && entry.detection?.netEdge).toBeCloseTo(opportunity.order.adjustedSpread, 10);
  });

  it("in live mode the same order is refused as two_leg_execution_not_implemented — nothing is sent", async () => {
    const walletClient = mockWalletClient();
    const result = await runAgentLoop(loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { getMode: () => "live", walletClient }));

    expect(result.triggered[0]!.outcome).toBe("two_leg_execution_not_implemented");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("the pipeline's freshness re-check uses the same gas figure detection used", async () => {
    // A small edge priced with the live gas figure. If the re-check fell
    // back to the pipeline's flat $0.21 instead, the fresh edge would
    // keep under half the detected one and the trade would close.
    const expensive = 497.18;
    const liveGas: EstimateGasFn = async () => ({ gasCostUsd: 0.027, source: "live" });
    const edgeWith = (gasCostUsd: number) =>
      adjustedSpread({
        effectiveBuyPriceUsd: feeAdjustedPrice(SYNTHETIC_CHEAP, 2500, "buy"),
        effectiveSellPriceUsd: feeAdjustedPrice(expensive, 10000, "sell"),
        slippagePct: 0.0005,
        gasCostUsd,
        tradeSizeUsd: 200,
      });
    expect(edgeWith(0.21) / edgeWith(0.027)).toBeLessThan(DEFAULT_GUARDRAIL_CONFIG.minSpreadRetentionRatio);

    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, expensive, { estimateGasFn: liveGas, priceHistory: historyWith(10, SYNTHETIC_CHEAP, expensive) })
    );
    expect(result.triggered[0]!.outcome).toBe("dry_run_only");
  });
});

describe("runAgentLoop — spread_closed only comes from a real proposed order's edge decaying", () => {
  it("positive at detection, negative at the pre-send re-read: spread_closed", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();

    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, {
        ledger,
        walletClient,
        // Between detection and send, the pools move to the live reading.
        fetchFreshPoolPrices: freshPrices(LIVE_CHEAP, LIVE_EXPENSIVE),
      })
    );

    expect(result.triggered[0]!.outcome).toBe("spread_closed");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(ledger.readAll().map((e) => e.outcome)).toEqual(["spread_closed"]);
  });

  it("a negative edge at detection never produces spread_closed — it never becomes an order", async () => {
    const ledger = new AuditLedger();
    await runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { ledger }));
    expect(ledger.readAll().some((e) => e.outcome === "spread_closed")).toBe(false);
  });
});

describe("runAgentLoop — narrator failures never change the constructed order (PRD rule 1)", () => {
  it("produces an identical order, verdict, and outcome whether or not narration succeeds", async () => {
    const run = (narrateProposalFn?: () => string) =>
      runAgentLoop(loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { narrateProposalFn }));

    const successfulRun = await run();
    const failingRun = await run(() => {
      throw new Error("narrator exploded");
    });

    expect(failingRun.triggered[0]!.order).toEqual(successfulRun.triggered[0]!.order);
    expect(failingRun.triggered[0]!.verdict.approved).toBe(successfulRun.triggered[0]!.verdict.approved);
    expect(failingRun.triggered[0]!.outcome).toBe(successfulRun.triggered[0]!.outcome);
    expect(failingRun.triggered[0]!.narration).toContain("narrator exploded");
  });
});

describe("previewOpportunities — read-only, never writes the ledger, the price history, or calls the wallet", () => {
  it("live negative edge: spreads returned, no opportunities, no ledger writes, no history writes", async () => {
    const before = defaultLedger.readAll().length;
    const history = new BoundedPriceHistory();

    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      estimateGasFn: pinnedGas,
      priceHistory: history,
    });

    expect(result.spreads).toHaveLength(1);
    expect(result.opportunities).toHaveLength(0);
    expect(defaultLedger.readAll().length).toBe(before);
    expect(history.recent(POOL_025)).toEqual([]);
  });

  it("during warm-up: no opportunity, and the warm-up status is reported", async () => {
    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
      estimateGasFn: pinnedGas,
      priceHistory: historyWith(2, SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE),
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.warmUp.MSFT).toEqual({ readings: 2, required: 10, complete: false });
  });

  it("positive edge above threshold after warm-up: one narrated opportunity, dry-run floor pending", async () => {
    const fetchReferenceFn = agreeingReference(SYNTHETIC_CHEAP);
    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
      estimateGasFn: pinnedGas,
      fetchReferenceFn,
      fetchMarketStatusFn: tradingStatus(),
      priceHistory: warmHistory(),
    });

    expect(result.opportunities).toHaveLength(1);
    const verdict = result.opportunities[0]!.verdict;
    expect(verdict.approved).toBe(true);
    expect(verdict.checks.find((c) => c.name === "referencePrice")?.ok).toBe(true);
    expect(verdict.checks.find((c) => c.name === "dryRunFloor")?.pending).toBe(true);
    expect(result.opportunities[0]!.narration).toContain("MSFT");
    expect(fetchReferenceFn).toHaveBeenCalledTimes(1);
  });

  it("doesn't call Binance when no order is built", async () => {
    const fetchReferenceFn = agreeingReference(LIVE_CHEAP);
    await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      estimateGasFn: pinnedGas,
      fetchReferenceFn,
      fetchMarketStatusFn: tradingStatus(),
      priceHistory: warmHistory(),
    });
    expect(fetchReferenceFn).not.toHaveBeenCalled();
  });
});

describe("runAgentLoop — Binance reference price", () => {
  it("fetches the reference every tick at the order size and records it on the detection, even with no order", async () => {
    const ledger = new AuditLedger();
    const fetchReferenceFn = vi.fn(async () => ({ status: "ok" as const, priceUsd: 498.8459, vendor: "LiquidMesh", route: "Rfq Neptunex" }));

    await runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { ledger, fetchReferenceFn }));

    expect(fetchReferenceFn).toHaveBeenCalledWith({ ticker: "MSFT", cheapPoolAddress: POOL_025, sizeUsd: 200 });
    const entry = ledger.readAll()[0]!;
    expect(entry.kind === "detection" && entry.detection.reference).toEqual({
      status: "ok",
      priceUsd: 498.8459,
      vendor: "LiquidMesh",
      route: "Rfq Neptunex",
    });
  });

  it("records why the reference was unavailable", async () => {
    const ledger = new AuditLedger();
    const fetchReferenceFn = vi.fn(async () => ({ status: "unavailable" as const, reason: "getaddrinfo ENOTFOUND web3.binance.com" }));

    await runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { ledger, fetchReferenceFn }));

    const entry = ledger.readAll()[0]!;
    expect(entry.kind === "detection" && entry.detection.reference).toEqual({
      status: "unavailable",
      reason: "getaddrinfo ENOTFOUND web3.binance.com",
    });
  });

  it("an order built on the tick carries the same reference, and one fetch serves both", async () => {
    const fetchReferenceFn = agreeingReference(SYNTHETIC_CHEAP);
    const result = await runAgentLoop(loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, { fetchReferenceFn }));

    expect(fetchReferenceFn).toHaveBeenCalledTimes(1);
    expect(result.triggered[0]!.order.reference).toEqual(expect.objectContaining({ status: "ok", priceUsd: SYNTHETIC_CHEAP * 1.0025 }));
    expect(result.triggered[0]!.verdict.checks.find((c) => c.name === "referencePrice")?.ok).toBe(true);
  });

  it("an unavailable reference blocks the order at the guardrail — no reference, no trade", async () => {
    const walletClient = mockWalletClient();
    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, {
        walletClient,
        fetchReferenceFn: vi.fn(async () => ({ status: "unavailable" as const, reason: "HTTP 503" })),
      })
    );

    expect(result.triggered[0]!.outcome).toBe("blocked");
    expect(result.triggered[0]!.verdict.blockedBy).toBe("referencePrice");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("a pool price far from the reference blocks the order", async () => {
    const result = await runAgentLoop(
      loopDeps(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE, {
        fetchReferenceFn: vi.fn(async () => ({ status: "ok" as const, priceUsd: 530, vendor: "LiquidMesh", route: "stub" })),
      })
    );

    expect(result.triggered[0]!.outcome).toBe("blocked");
    expect(result.triggered[0]!.verdict.reason).toContain("from the Binance reference $530.0000");
  });
});

describe("computeSpreads and defaults", () => {
  it("returns the live gross gap and net edge, and the gas figure used", async () => {
    const spreads = await computeSpreads({
      underlyings: ["MSFT"],
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      estimateGasFn: pinnedGas,
    });

    expect(spreads[0]!.rawSpread).toBeCloseTo(0.00124, 5);
    expect(spreads[0]!.adjustedSpread).toBeCloseTo(-0.0128, 3);
    expect(spreads[0]!.gas).toEqual({ costUsd: 0.21, source: "fallback" });
  });

  it("passes both pools, the trade size, the safety multiplier, and the fallback to the gas estimator", async () => {
    const estimateGasFn = vi.fn(pinnedGas);
    await computeSpreads({
      underlyings: ["MSFT"],
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      estimateGasFn,
      gasSafetyMultiplier: 3,
      fallbackGasCostUsd: 0.5,
      tradeSizeUsd: 150,
    });

    expect(estimateGasFn).toHaveBeenCalledWith(
      expect.objectContaining({
        stablecoin: STABLECOIN,
        cheapPool: expect.objectContaining({ address: POOL_025, feeUnits: 2500 }),
        expensivePool: expect.objectContaining({ address: POOL_1, feeUnits: 10000 }),
        tradeSizeUsd: 150,
        safetyMultiplier: 3,
        fallbackGasCostUsd: 0.5,
      })
    );
  });

  it("a live gas figure lowers the cost term compared with the flat fallback", async () => {
    const quotes = vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE));
    const [flat] = await computeSpreads({ underlyings: ["MSFT"], fetchPoolQuotesFn: quotes, estimateGasFn: pinnedGas });
    const [live] = await computeSpreads({
      underlyings: ["MSFT"],
      fetchPoolQuotesFn: quotes,
      estimateGasFn: async () => ({ gasCostUsd: 0.027, source: "live" }),
    });
    expect(live!.adjustedSpread).toBeGreaterThan(flat!.adjustedSpread);
  });

  it("defaults to only tickers with at least two registered pools", () => {
    expect(DEFAULT_AGENT_LOOP_CONFIG.underlyings).toEqual(["MSFT"]);
  });

  it("defaults the gas safety multiplier to 2", () => {
    expect(DEFAULT_AGENT_LOOP_CONFIG.gasSafetyMultiplier).toBe(2);
  });
});

describe("runAgentLoop — the underlying market status is recorded on every evaluation", () => {
  it("fetches it every tick and puts it, reasonMsg included, on the detection entry", async () => {
    const ledger = new AuditLedger();
    // SYNTHETIC closed-market status in the documented shape.
    const closed = {
      status: "ok" as const,
      openState: false,
      reasonCode: "MARKET_CLOSED",
      marketStatus: "closed",
      reasonMsg: "Weekend or Holiday",
      nextOpenTime: 1790596200000,
      nextCloseTime: null,
      fetchedAt: "2026-09-26T12:00:00.000Z",
    };
    const fetchMarketStatusFn = vi.fn(async () => closed);
    await runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { ledger, fetchMarketStatusFn }));

    expect(fetchMarketStatusFn).toHaveBeenCalledWith({ ticker: "MSFT", cheapPoolAddress: POOL_025 });
    const entry = ledger.readAll()[0]!;
    expect(entry.kind).toBe("detection");
    expect(entry.kind === "detection" && entry.detection.marketStatus).toEqual(closed);
  });

  it("records an unavailable status too, rather than dropping the evaluation", async () => {
    const ledger = new AuditLedger();
    const unavailable = { status: "unavailable" as const, reason: "The operation was aborted due to timeout", fetchedAt: "2026-09-25T12:00:00.000Z" };
    await runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { ledger, fetchMarketStatusFn: vi.fn(async () => unavailable) }));
    const entry = ledger.readAll()[0]!;
    expect(entry.kind === "detection" && entry.detection.marketStatus).toEqual(unavailable);
  });
});

describe("runAgentLoop — independent Binance calls in a tick run concurrently", () => {
  it("the reference quote and the market status are both in flight before either returns", async () => {
    const started: string[] = [];
    let releaseReference!: () => void;
    let releaseStatus!: () => void;
    const fetchReferenceFn = vi.fn(async () => {
      started.push("reference");
      await new Promise<void>((r) => (releaseReference = r));
      return { status: "ok" as const, priceUsd: LIVE_CHEAP * 1.0025, vendor: "LiquidMesh", route: "stub" };
    });
    const fetchMarketStatusFn = vi.fn(async () => {
      started.push("marketStatus");
      await new Promise<void>((r) => (releaseStatus = r));
      return { status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" };
    });

    const done = runAgentLoop(loopDeps(LIVE_CHEAP, LIVE_EXPENSIVE, { fetchReferenceFn, fetchMarketStatusFn }));
    // Let the loop reach the Binance step without resolving either call.
    await vi.waitFor(() => expect(started.length).toBe(2));
    expect(started.sort()).toEqual(["marketStatus", "reference"]);

    releaseStatus();
    releaseReference();
    await done;
  });
});
