import { describe, it, expect, vi } from "vitest";
import { runPipeline, type WalletClient, type SwapRequest } from "./pipeline";
import { AuditLedger } from "./audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { ProposedOrder } from "../guardrails/check";
import { navEquivalent } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";
import { accruedDividend } from "../data/dividend-calendar";

const config = DEFAULT_GUARDRAIL_CONFIG;

function baseOrder(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    ticker: "NVDAon",
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

// A stub swap-request builder: tests exercise guardrail/mode logic, not
// the real token-address registry (empty) or trading-wallet credentials
// (unset), so this bypasses both without needing either configured.
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

function mockWalletClient(overrides: Partial<WalletClient> = {}): WalletClient {
  return {
    approvalCheck: vi.fn().mockResolvedValue({ needsApproval: false, raw: {} }),
    dryRun: vi.fn().mockResolvedValue({ outputUsd: 199, unsignedTransaction: { to: "0xRouter", data: "0xdead" }, raw: {} }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
    ...overrides,
  };
}

describe("runPipeline — blocked verdicts never reach the wallet", () => {
  it("does not call approvalCheck/dryRun/send when the daily cap blocks the order", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 1900, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.approvalCheck).not.toHaveBeenCalled();
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("does not call approvalCheck/dryRun/send when the order fails sanity/liquidity, even in live mode", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder({ liquidityDepthUsd: 1 }),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.approvalCheck).not.toHaveBeenCalled();
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });
});

describe("runPipeline — mode gating", () => {
  it("defaults to dry-run mode when mode is omitted, never live", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(baseOrder(), {
      spentTodaySoFarUsd: 0,
      config,
      walletClient,
      buildSwapRequest: fakeBuildSwapRequest,
      ledger,
    });

    expect(entry.mode).toBe("dry-run");
    expect(entry.outcome).toBe("dry_run_only");
    expect(walletClient.approvalCheck).toHaveBeenCalledTimes(1);
    expect(walletClient.dryRun).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("simulation mode never calls the wallet at all for an approved order", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "simulation"
    );

    expect(entry.outcome).toBe("simulated");
    expect(walletClient.approvalCheck).not.toHaveBeenCalled();
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("live mode calls approvalCheck, then dryRun, then send, in order, when no approval is needed", async () => {
    const calls: string[] = [];
    const walletClient: WalletClient = {
      approvalCheck: vi.fn().mockImplementation(async () => {
        calls.push("approvalCheck");
        return { needsApproval: false, raw: {} };
      }),
      dryRun: vi.fn().mockImplementation(async () => {
        calls.push("dryRun");
        return { outputUsd: 199, unsignedTransaction: { to: "0xRouter", data: "0xdead" }, raw: {} };
      }),
      send: vi.fn().mockImplementation(async () => {
        calls.push("send");
        return { txId: "0xdeadbeef", raw: {} };
      }),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );

    expect(calls).toEqual(["approvalCheck", "dryRun", "send"]);
    expect(entry.outcome).toBe("executed");
    expect(entry.approval).toEqual({ needed: false });
    expect(entry.send).toEqual({ txId: "0xdeadbeef" });
  });

  it("live mode sends the approval transaction first when one is needed, before the swap's dryRun/send", async () => {
    const calls: string[] = [];
    const walletClient: WalletClient = {
      approvalCheck: vi.fn().mockImplementation(async () => {
        calls.push("approvalCheck");
        return { needsApproval: true, approvalTransaction: { to: "0xToken", data: "0xapprove" }, raw: {} };
      }),
      dryRun: vi.fn().mockImplementation(async () => {
        calls.push("dryRun");
        return { outputUsd: 199, unsignedTransaction: { to: "0xRouter", data: "0xswap" }, raw: {} };
      }),
      send: vi.fn().mockImplementation(async (tx) => {
        calls.push(`send:${tx.data}`);
        return { txId: tx.data === "0xapprove" ? "0xapprovaltx" : "0xswaptx" };
      }),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );

    expect(calls).toEqual(["approvalCheck", "send:0xapprove", "dryRun", "send:0xswap"]);
    expect(entry.outcome).toBe("executed");
    expect(entry.approval).toEqual({ needed: true, txId: "0xapprovaltx" });
    expect(entry.send).toEqual({ txId: "0xswaptx" });
  });

  it("live mode stops with approval_failed if the approval transaction can't be sent, and never reaches dryRun/the swap send", async () => {
    const walletClient: WalletClient = {
      approvalCheck: vi.fn().mockResolvedValue({
        needsApproval: true,
        approvalTransaction: { to: "0xToken", data: "0xapprove" },
        raw: {},
      }),
      dryRun: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error("insufficient gas")),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );

    expect(entry.outcome).toBe("approval_failed");
    expect(entry.approval).toEqual({ needed: true, error: "insufficient gas" });
    expect(walletClient.dryRun).not.toHaveBeenCalled();
  });

  it("dry-run mode never sends even when an approval is needed", async () => {
    const walletClient = mockWalletClient({
      approvalCheck: vi.fn().mockResolvedValue({
        needsApproval: true,
        approvalTransaction: { to: "0xToken", data: "0xapprove" },
        raw: {},
      }),
    });
    const ledger = new AuditLedger();

    const entry = await runPipeline(baseOrder(), {
      spentTodaySoFarUsd: 0,
      config,
      walletClient,
      buildSwapRequest: fakeBuildSwapRequest,
      ledger,
    });

    expect(entry.mode).toBe("dry-run");
    expect(entry.outcome).toBe("dry_run_only");
    expect(entry.approval).toEqual({ needed: true });
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("live mode never calls send for the swap when the fresh dry-run output falls below the floor", async () => {
    const walletClient = mockWalletClient({
      dryRun: vi.fn().mockResolvedValue({ outputUsd: 50, unsignedTransaction: { to: "0xRouter", data: "0xdead" }, raw: {} }),
    });
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );

    expect(entry.outcome).toBe("dry_run_failed");
    expect(walletClient.send).not.toHaveBeenCalled();
  });
});

describe("runPipeline — every outcome produces exactly one ledger entry", () => {
  it("blocked: exactly one entry", async () => {
    const ledger = new AuditLedger();
    await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 1900, config, walletClient: mockWalletClient(), buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("blocked");
  });

  it("approved + dry-run-failed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient({
      dryRun: vi.fn().mockResolvedValue({ outputUsd: 1, unsignedTransaction: { to: "0xRouter", data: "0xdead" }, raw: {} }),
    });
    await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("dry_run_failed");
  });

  it("approved + executed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), buildSwapRequest: fakeBuildSwapRequest, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("executed");
  });
});

describe("runPipeline — MSFT ex-div scenario end-to-end in dry-run mode", () => {
  it("composes Phases 1–3 without modification to earlier phases' code", async () => {
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

    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      order,
      { spentTodaySoFarUsd: 0, config, walletClient, buildSwapRequest: fakeBuildSwapRequest, ledger },
      "dry-run"
    );

    expect(entry.verdict.approved).toBe(true);
    expect(entry.outcome).toBe("dry_run_only");
    expect(walletClient.dryRun).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });
});
