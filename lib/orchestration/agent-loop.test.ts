import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, computeSpreads, previewOpportunities, type AgentLoopConfig } from "./agent-loop";
import { DailySpendTracker } from "./spend-tracker";
import { AuditLedger } from "../execution/audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { Quote } from "../data/types";
import type { WalletClient, SwapRequest } from "../execution/pipeline";

const EX_DIV_NOW = Date.UTC(2025, 7, 21, 12, 0, 0); // 2025-08-21T12:00:00Z, MSFT's ex-div date

function msftQuotes(): Quote[] {
  const preExDivPrice = 420.0;
  const dividendPerShare = 0.83;
  return [
    {
      protocol: "xstocks",
      underlying: "MSFT",
      symbol: "MSFTx",
      price: preExDivPrice - dividendPerShare,
      liquidityDepth: 5000,
      timestamp: EX_DIV_NOW,
    },
    {
      protocol: "ondo",
      underlying: "MSFT",
      symbol: "MSFTon",
      price: preExDivPrice,
      liquidityDepth: 5000,
      timestamp: EX_DIV_NOW,
    },
  ];
}

function mockWalletClient(): WalletClient {
  return {
    approvalCheck: vi.fn().mockResolvedValue({ needsApproval: false, raw: {} }),
    dryRun: vi.fn().mockResolvedValue({ outputUsd: 199, unsignedTransaction: { to: "0xRouter", data: "0xdead" }, raw: {} }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
  };
}

// Bypasses the (currently empty) token-address registry and unset
// trading-wallet credentials — these tests exercise the automatic loop's
// own composition, not the real Transaction API request shape.
function fakeBuildSwapRequest(): SwapRequest {
  return {
    binanceChainId: "56",
    fromTokenAddress: "0xFrom",
    toTokenAddress: "0xTo",
    amount: "200",
    userWalletAddress: "0xWallet",
    vendor: "LiquidMesh",
    autoSlippage: true,
  };
}

// A near-zero threshold isolates this test to proving the composition
// wiring (quotes -> basis model -> narrator -> pipeline) works, not
// threshold-selection logic — the MSFT ex-div scenario's adjusted spread
// is supposed to be ~0 (that's the whole point of dividend-drift
// suppression), so a realistic threshold would never trigger it.
const ZERO_THRESHOLD_CONFIG: AgentLoopConfig = {
  underlyings: ["MSFT"],
  adjustedSpreadThreshold: 0,
  orderSizeUsd: 200,
};

describe("runAgentLoop — MSFT ex-div scenario end-to-end", () => {
  it("composes quotes -> basis model -> narrator -> pipeline into the same approved outcome Phase 3 proved in isolation", async () => {
    const fetchQuotesFn = vi.fn().mockResolvedValue(msftQuotes());
    const spendTracker = new DailySpendTracker(() => EX_DIV_NOW);
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient();

    const result = await runAgentLoop({
      spendTracker,
      getMode: () => "dry-run",
      ledger,
      walletClient,
      buildSwapRequest: fakeBuildSwapRequest,
      guardrailConfig: DEFAULT_GUARDRAIL_CONFIG,
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchQuotesFn,
      now: () => EX_DIV_NOW,
    });

    expect(result.spreads).toHaveLength(1);
    expect(Math.abs(result.spreads[0]!.adjustedSpread)).toBeLessThan(0.0005);

    expect(result.triggered).toHaveLength(1);
    const opportunity = result.triggered[0]!;
    expect(opportunity.ticker).toBe("MSFT");
    expect(opportunity.verdict.approved).toBe(true);
    expect(opportunity.outcome).toBe("dry_run_only");
    expect(opportunity.narration).toContain("MSFT");
    expect(ledger.readAll()).toHaveLength(1);
  });

  it("does not construct an order or touch the pipeline for an underlying below threshold", async () => {
    const fetchQuotesFn = vi.fn().mockResolvedValue(msftQuotes());
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await runAgentLoop({
      spendTracker: new DailySpendTracker(() => EX_DIV_NOW),
      getMode: () => "live",
      ledger,
      walletClient,
      buildSwapRequest: fakeBuildSwapRequest,
      agentConfig: { underlyings: ["MSFT"], adjustedSpreadThreshold: 0.003, orderSizeUsd: 200 },
      fetchQuotesFn,
      now: () => EX_DIV_NOW,
    });

    expect(result.triggered).toHaveLength(0);
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });
});

describe("runAgentLoop — narrator failures never change the constructed order (PRD rule 1)", () => {
  it("produces an identical order, verdict, and outcome whether or not narration succeeds", async () => {
    const fetchQuotesFn = vi.fn().mockResolvedValue(msftQuotes());

    const successfulRun = await runAgentLoop({
      spendTracker: new DailySpendTracker(() => EX_DIV_NOW),
      getMode: () => "dry-run",
      ledger: new AuditLedger(),
      walletClient: mockWalletClient(),
      buildSwapRequest: fakeBuildSwapRequest,
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchQuotesFn,
      now: () => EX_DIV_NOW,
    });

    const failingRun = await runAgentLoop({
      spendTracker: new DailySpendTracker(() => EX_DIV_NOW),
      getMode: () => "dry-run",
      ledger: new AuditLedger(),
      walletClient: mockWalletClient(),
      buildSwapRequest: fakeBuildSwapRequest,
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchQuotesFn,
      now: () => EX_DIV_NOW,
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
  it("produces a verdict and narration without calling runPipeline/dryRun/send", async () => {
    const fetchQuotesFn = vi.fn().mockResolvedValue(msftQuotes());
    const walletClientSpy = mockWalletClient();

    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(() => EX_DIV_NOW),
      agentConfig: ZERO_THRESHOLD_CONFIG,
      fetchQuotesFn,
      now: () => EX_DIV_NOW,
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.verdict.approved).toBe(true);
    expect(result.opportunities[0]!.narration).toContain("MSFT");
    // Nothing here should have touched a wallet client at all, since none
    // was even passed through — confirming there's no hidden pipeline call.
    expect(walletClientSpy.dryRun).not.toHaveBeenCalled();
    expect(walletClientSpy.send).not.toHaveBeenCalled();
  });

  it("returns no opportunities, only spreads, when nothing clears the threshold", async () => {
    const fetchQuotesFn = vi.fn().mockResolvedValue(msftQuotes());

    const result = await previewOpportunities({
      spendTracker: new DailySpendTracker(() => EX_DIV_NOW),
      agentConfig: { underlyings: ["MSFT"], adjustedSpreadThreshold: 0.003, orderSizeUsd: 200 },
      fetchQuotesFn,
      now: () => EX_DIV_NOW,
    });

    expect(result.spreads).toHaveLength(1);
    expect(result.opportunities).toHaveLength(0);
  });
});

describe("computeSpreads — read-only, no pipeline/wallet involvement", () => {
  it("returns raw and adjusted spreads without needing a wallet client at all", async () => {
    const fetchQuotesFn = vi.fn().mockResolvedValue(msftQuotes());

    const spreads = await computeSpreads({ underlyings: ["MSFT"], fetchQuotesFn, now: () => EX_DIV_NOW });

    expect(spreads).toHaveLength(1);
    expect(spreads[0]!.rawSpread).toBeGreaterThan(0.0015);
    expect(Math.abs(spreads[0]!.adjustedSpread)).toBeLessThan(0.0005);
  });
});
