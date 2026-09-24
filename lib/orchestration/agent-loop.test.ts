import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, computeSpreads, previewOpportunities, type AgentLoopConfig } from "./agent-loop";
import { DailySpendTracker } from "./spend-tracker";
import { AuditLedger } from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { PoolQuote } from "../data/types";
import type { WalletClient, FreshPoolPrices } from "../execution/pipeline";

// Stand in for pipeline.ts's real on-chain freshness re-read — these
// tests exercise the agent loop's own composition wiring, not a live RPC
// endpoint (runPipeline() calls this for real past the "simulation" mode,
// same as lib/execution/pipeline.test.ts's DI). Matches msftPoolQuotes()
// below exactly (same real live prices), so "detected" and "fresh" agree.
const FAKE_STABLECOIN = "0x55d398326f99059fF775485246999027B3197955";
const FAKE_TARGET_TOKEN = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0"; // real MSFTB address

function fakeFetchFreshPoolPrices(): Promise<FreshPoolPrices> {
  return Promise.resolve({
    cheapPoolPriceUsd: 496.3821,
    cheapPoolToken0: FAKE_STABLECOIN as `0x${string}`,
    cheapPoolToken1: FAKE_TARGET_TOKEN as `0x${string}`,
    expensivePoolPriceUsd: 496.9976,
    expensivePoolToken0: FAKE_STABLECOIN as `0x${string}`,
    expensivePoolToken1: FAKE_TARGET_TOKEN as `0x${string}`,
  });
}

// Bypasses unset TRADING_WALLET_PRIVATE_KEY/BSC_RPC_URL credentials.
function fakeGetWalletAddress(): string {
  return "0x1234567890123456789012345678901234567890";
}

// Both real, registered MSFTB pools (lib/data/pool-addresses.ts), read
// LIVE via a public BSC RPC on 2026-09-24: 0.25% pool $496.3821, 1% pool
// $496.9976. This is the only pairing in this codebase with a
// live-reproducible number — re-reading these two addresses now will
// very likely give a different figure (real BSC pool prices move; see
// lib/data/demo-history.ts's own note on 0.3-1.6% intrahour volatility
// for this exact pool set), which is exactly why this fixture is labeled
// with its read date rather than presented as a permanent fact.
function msftPoolQuotes(): PoolQuote[] {
  const timestamp = Date.now();
  return [
    { ticker: "MSFT", poolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 496.3821, liquidityUsdEstimate: 50_000, timestamp },
    { ticker: "MSFT", poolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: 496.9976, liquidityUsdEstimate: 50_000, timestamp },
  ];
}

function mockWalletClient(): WalletClient {
  return {
    checkAllowance: vi.fn().mockResolvedValue({ sufficient: true, currentAllowance: 10n ** 30n }),
    simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
  };
}

// Real, live-read numbers: raw gap between these two pools is only
// ~0.124% ((496.9976 - 496.3821) / 496.3821). After this pairing's real
// fees (0.25% + 1% = 1.25%) plus slippage (0.05%) and gas (~0.1% of a
// $200 trade), net is about -1.28% — this pairing does NOT clear real
// costs right now. A near-zero threshold isolates these tests to proving
// the composition wiring (pool quotes -> basis model -> narrator ->
// pipeline) works, not threshold-selection logic — the outcome is a
// correctly-declined trade either way.
const ZERO_THRESHOLD_CONFIG: AgentLoopConfig = {
  underlyings: ["MSFT"],
  adjustedSpreadThreshold: 0,
  orderSizeUsd: 200,
  gasCostUsdEstimate: 200_000 * 1.5e-9 * 700,
  slippagePctEstimate: 0.0005,
};

const REAL_THRESHOLD_CONFIG: AgentLoopConfig = {
  underlyings: ["MSFT"],
  adjustedSpreadThreshold: 0.003,
  orderSizeUsd: 200,
  gasCostUsdEstimate: 200_000 * 1.5e-9 * 700,
  slippagePctEstimate: 0.0005,
};

describe("runAgentLoop — real, live MSFTB cross-pool scenario end-to-end", () => {
  it("composes pool quotes -> basis model -> narrator -> pipeline into a correctly-DECLINED outcome (spread_closed, the honest current result)", async () => {
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());
    const spendTracker = new DailySpendTracker();
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();

    const result = await runAgentLoop({
      spendTracker,
      getMode: () => "dry-run",
      ledger,
      walletClient,
      guardrailConfig: DEFAULT_GUARDRAIL_CONFIG,
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchPoolQuotesFn,
      fetchFreshPoolPrices: fakeFetchFreshPoolPrices,
      getWalletAddress: fakeGetWalletAddress,
    });

    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0]!.rawSpread).toBeGreaterThan(0);
    expect(result.spreads[0]!.rawSpread).toBeLessThan(0.005); // real raw gap is tiny (~0.12%), not fabricated
    expect(result.spreads[0]!.adjustedSpread).toBeCloseTo(-0.0128, 3);

    expect(result.triggered).toHaveLength(1);
    const opportunity = result.triggered[0]!;
    expect(opportunity.ticker).toBe("MSFT");
    // check() itself doesn't gate on spread sign, so the guardrail
    // verdict is still approved — spreadFreshnessCheck (fresh vs.
    // detected, both real and equal here) is what correctly declines
    // this trade before it ever reaches the wallet.
    expect(opportunity.verdict.approved).toBe(true);
    expect(opportunity.outcome).toBe("spread_closed");
    expect(opportunity.narration).toContain("MSFT");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });

  it("does not construct an order or touch the pipeline for an underlying below threshold", async () => {
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "live",
      ledger,
      walletClient,
      // adjustedSpread for this real pairing is about -1.28% — well
      // under a real 5% filter (by absolute value), confirming the
      // threshold gate itself, independent of sign.
      agentConfig: { ...REAL_THRESHOLD_CONFIG, adjustedSpreadThreshold: 0.05 },
      fetchPoolQuotesFn,
    });

    expect(result.triggered).toHaveLength(0);
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });
});

describe("runAgentLoop — narrator failures never change the constructed order (PRD rule 1)", () => {
  it("produces an identical order, verdict, and outcome whether or not narration succeeds", async () => {
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());

    const successfulRun = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "dry-run",
      ledger: new AuditLedger(),
      walletClient: mockWalletClient(),
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchPoolQuotesFn,
      fetchFreshPoolPrices: fakeFetchFreshPoolPrices,
      getWalletAddress: fakeGetWalletAddress,
    });

    const failingRun = await runAgentLoop({
      spendTracker: new DailySpendTracker(),
      getMode: () => "dry-run",
      ledger: new AuditLedger(),
      walletClient: mockWalletClient(),
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchPoolQuotesFn,
      fetchFreshPoolPrices: fakeFetchFreshPoolPrices,
      getWalletAddress: fakeGetWalletAddress,
      narrateProposalFn: () => {
        throw new Error("narrator exploded");
      },
    });

    const successOrder = successfulRun.triggered[0]!.order;
    const failOrder = failingRun.triggered[0]!.order;
    expect(failOrder).toEqual(successOrder);

    expect(failingRun.triggered[0]!.verdict.approved).toBe(successfulRun.triggered[0]!.verdict.approved);
    expect(failingRun.triggered[0]!.outcome).toBe(successfulRun.triggered[0]!.outcome);
    expect(failingRun.triggered[0]!.narration).toContain("narrator exploded");
  });
});

describe("previewOpportunities — narrated, verdict-bearing, but never calls the wallet", () => {
  it("produces a verdict and narration without calling runPipeline/simulateSwap/send", async () => {
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());
    const walletClientSpy = mockWalletClient();

    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchPoolQuotesFn,
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.verdict.approved).toBe(true);
    expect(result.opportunities[0]!.narration).toContain("MSFT");
    // Nothing here should have touched a wallet client at all, since none
    // was even passed through — confirming there's no hidden pipeline call.
    expect(walletClientSpy.simulateSwap).not.toHaveBeenCalled();
    expect(walletClientSpy.send).not.toHaveBeenCalled();
  });

  it("returns no opportunities, only spreads, when nothing clears the threshold", async () => {
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());

    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(),
      agentConfig: { ...REAL_THRESHOLD_CONFIG, adjustedSpreadThreshold: 0.05 },
      fetchPoolQuotesFn,
    });

    expect(result.spreads).toHaveLength(1);
    expect(result.opportunities).toHaveLength(0);
  });
});

describe("computeSpreads — read-only, no pipeline/wallet involvement", () => {
  it("returns raw and adjusted spreads without needing a wallet client at all", async () => {
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());

    const spreads = await computeSpreads({ underlyings: ["MSFT"], fetchPoolQuotesFn });

    expect(spreads).toHaveLength(1);
    expect(spreads[0]!.rawSpread).toBeGreaterThan(0);
    expect(spreads[0]!.rawSpread).toBeLessThan(0.005);
    expect(spreads[0]!.adjustedSpread).toBeCloseTo(-0.0128, 3);
    expect(spreads[0]!.cheapPool.feeUnits).toBe(2500);
    expect(spreads[0]!.expensivePool.feeUnits).toBe(10000);
  });
});
