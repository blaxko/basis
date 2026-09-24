import { describe, it, expect, vi } from "vitest";
import {
  runAgentLoop,
  computeSpreads,
  previewOpportunities,
  DEFAULT_AGENT_LOOP_CONFIG,
  type AgentLoopConfig,
} from "./agent-loop";
import { DailySpendTracker } from "./spend-tracker";
import { AuditLedger, defaultLedger } from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { PoolQuote } from "../data/types";
import type { WalletClient, FreshPoolPrices } from "../execution/pipeline";

const STABLECOIN = "0x55d398326f99059fF775485246999027B3197955" as const;
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" as const; // real MSFTB address
const POOL_025 = "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea";
const POOL_1 = "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44";

// LIVE: both real registered MSFTB pools, read via a public BSC RPC on
// 2026-09-24 — 0.25% pool $496.3821, 1% pool $496.9976. Net of fees,
// slippage, and gas this is about -1.28%. Re-reading the pools now will
// give a different number.
const LIVE_CHEAP = 496.3821;
const LIVE_EXPENSIVE = 496.9976;

// SYNTHETIC: made-up prices on the same real pools, chosen to give a
// positive net edge (~+0.61%) so the order-building path can be tested.
// Not a reading of anything.
const SYNTHETIC_CHEAP = 490;
const SYNTHETIC_EXPENSIVE = 500;

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

// Bypasses unset TRADING_WALLET_PRIVATE_KEY/BSC_RPC_URL credentials.
const getWalletAddress = () => "0x1234567890123456789012345678901234567890";

function mockWalletClient(): WalletClient {
  return {
    checkAllowance: vi.fn().mockResolvedValue({ sufficient: true, currentAllowance: 10n ** 30n }),
    simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
  };
}

const CONFIG: AgentLoopConfig = {
  underlyings: ["MSFT"],
  adjustedSpreadThreshold: 0.0001,
  orderSizeUsd: 200,
  gasCostUsdEstimate: 200_000 * 1.5e-9 * 700,
  slippagePctEstimate: 0.0005,
};

describe("runAgentLoop — a negative net edge is a detection decision, not an order", () => {
  it("live -1.28% edge: zero orders, exactly one no_opportunity entry carrying both pool prices, gross gap, and net edge", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();
    const fetchFreshPoolPrices = vi.fn(freshPrices(LIVE_CHEAP, LIVE_EXPENSIVE));

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "live",
      ledger,
      walletClient,
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      fetchFreshPoolPrices,
      getWalletAddress,
    });

    expect(result.triggered).toHaveLength(0);
    expect(result.noOpportunities).toHaveLength(1);

    const entries = ledger.readAll();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("detection");
    expect(entry.outcome).toBe("no_opportunity");
    expect("verdict" in entry).toBe(false); // check() never ran — not a guardrail decision
    if (entry.kind !== "detection") throw new Error("unreachable");
    expect(entry.mode).toBe("live");
    expect(entry.detection.ticker).toBe("MSFT");
    expect(entry.detection.cheapPool).toEqual({ address: POOL_025, feeUnits: 2500, priceUsd: LIVE_CHEAP });
    expect(entry.detection.expensivePool).toEqual({ address: POOL_1, feeUnits: 10000, priceUsd: LIVE_EXPENSIVE });
    expect(entry.detection.grossGap).toBeCloseTo(0.00124, 5);
    expect(entry.detection.netEdge).toBeCloseTo(-0.0128, 3);
    expect(entry.detection.threshold).toBe(0.0001);

    expect(fetchFreshPoolPrices).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("a negative threshold can't turn a negative edge into an order", async () => {
    const ledger = new AuditLedger();

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "dry-run",
      ledger,
      walletClient: mockWalletClient(),
      agentConfig: { ...CONFIG, adjustedSpreadThreshold: -1 },
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      fetchFreshPoolPrices: freshPrices(LIVE_CHEAP, LIVE_EXPENSIVE),
      getWalletAddress,
    });

    expect(result.triggered).toHaveLength(0);
    expect(ledger.readAll().map((e) => e.outcome)).toEqual(["no_opportunity"]);
  });

  it("a positive edge that doesn't exceed the threshold is also no_opportunity", async () => {
    const ledger = new AuditLedger();

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "dry-run",
      ledger,
      walletClient: mockWalletClient(),
      agentConfig: { ...CONFIG, adjustedSpreadThreshold: 0.01 }, // synthetic edge is ~+0.61%
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
      fetchFreshPoolPrices: freshPrices(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE),
      getWalletAddress,
    });

    expect(result.triggered).toHaveLength(0);
    expect(result.noOpportunities[0]!.netEdge).toBeGreaterThan(0);
    expect(ledger.readAll().map((e) => e.outcome)).toEqual(["no_opportunity"]);
  });
});

describe("runAgentLoop — a positive net edge above threshold produces an order", () => {
  it("builds an order, runs it through the pipeline, and the pipeline entry carries the detection snapshot", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "dry-run",
      ledger,
      walletClient,
      guardrailConfig: DEFAULT_GUARDRAIL_CONFIG,
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
      fetchFreshPoolPrices: freshPrices(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE),
      getWalletAddress,
    });

    expect(result.noOpportunities).toHaveLength(0);
    expect(result.triggered).toHaveLength(1);
    const opportunity = result.triggered[0]!;
    expect(opportunity.order.adjustedSpread).toBeGreaterThan(0.0001);
    expect(opportunity.order.poolPair).toEqual({
      cheapPoolAddress: POOL_025,
      cheapPoolFeeUnits: 2500,
      expensivePoolAddress: POOL_1,
      expensivePoolFeeUnits: 10000,
    });
    expect(opportunity.outcome).toBe("dry_run_only");
    expect(walletClient.simulateSwap).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();

    const entries = ledger.readAll();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("pipeline");
    expect(entry.detection?.netEdge).toBeCloseTo(opportunity.order.adjustedSpread, 10);
  });
});

describe("runAgentLoop — spread_closed only comes from a real proposed order's edge decaying", () => {
  it("positive at detection, negative at the pre-send re-read: spread_closed", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "live",
      ledger,
      walletClient,
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
      // Between detection and send, the pools move to the live reading.
      fetchFreshPoolPrices: freshPrices(LIVE_CHEAP, LIVE_EXPENSIVE),
      getWalletAddress,
    });

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]!.outcome).toBe("spread_closed");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll().map((e) => e.outcome)).toEqual(["spread_closed"]);
  });

  it("a negative edge at detection never produces spread_closed — it never becomes an order", async () => {
    const ledger = new AuditLedger();

    await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "live",
      ledger,
      walletClient: mockWalletClient(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
      fetchFreshPoolPrices: freshPrices(LIVE_CHEAP, LIVE_EXPENSIVE),
      getWalletAddress,
    });

    expect(ledger.readAll().some((e) => e.outcome === "spread_closed")).toBe(false);
  });
});

describe("runAgentLoop — narrator failures never change the constructed order (PRD rule 1)", () => {
  it("produces an identical order, verdict, and outcome whether or not narration succeeds", async () => {
    const run = (narrateProposalFn?: () => string) =>
      runAgentLoop({
        spendTracker: new DailySpendTracker(),
        getMode: () => "dry-run",
        ledger: new AuditLedger(),
        walletClient: mockWalletClient(),
        agentConfig: CONFIG,
        fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
        fetchFreshPoolPrices: freshPrices(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE),
        getWalletAddress,
        narrateProposalFn,
      });

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

describe("previewOpportunities — read-only, never writes the ledger or calls the wallet", () => {
  it("live negative edge: spreads returned, no opportunities, no ledger writes", async () => {
    const before = defaultLedger.readAll().length;

    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
    });

    expect(result.spreads).toHaveLength(1);
    expect(result.opportunities).toHaveLength(0);
    expect(defaultLedger.readAll().length).toBe(before);
  });

  it("positive edge above threshold: one narrated, verdict-bearing opportunity", async () => {
    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: CONFIG,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(SYNTHETIC_CHEAP, SYNTHETIC_EXPENSIVE)),
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.verdict.approved).toBe(true);
    expect(result.opportunities[0]!.narration).toContain("MSFT");
  });
});

describe("computeSpreads and defaults", () => {
  it("returns the live gross gap and net edge without a wallet client", async () => {
    const spreads = await computeSpreads({
      underlyings: ["MSFT"],
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(poolQuotes(LIVE_CHEAP, LIVE_EXPENSIVE)),
    });

    expect(spreads).toHaveLength(1);
    expect(spreads[0]!.rawSpread).toBeCloseTo(0.00124, 5);
    expect(spreads[0]!.adjustedSpread).toBeCloseTo(-0.0128, 3);
    expect(spreads[0]!.cheapPool.feeUnits).toBe(2500);
    expect(spreads[0]!.expensivePool.feeUnits).toBe(10000);
  });

  it("defaults to only tickers with at least two registered pools", () => {
    expect(DEFAULT_AGENT_LOOP_CONFIG.underlyings).toEqual(["MSFT"]);
  });
});
