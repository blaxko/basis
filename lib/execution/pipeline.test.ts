import { describe, it, expect, vi } from "vitest";
import { runPipeline, type WalletClient } from "./pipeline";
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

function mockWalletClient(overrides: Partial<WalletClient> = {}): WalletClient {
  return {
    dryRun: vi.fn().mockResolvedValue({ outputUsd: 199, raw: {} }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
    ...overrides,
  };
}

describe("runPipeline — blocked verdicts never reach the wallet", () => {
  it("does not call dryRun or send when the daily cap blocks the order", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 1900, config, walletClient, ledger },
      "live"
    );

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("does not call dryRun or send when the order fails sanity/liquidity, even in live mode", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder({ liquidityDepthUsd: 1 }),
      { spentTodaySoFarUsd: 0, config, walletClient, ledger },
      "live"
    );

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });
});

describe("runPipeline — mode gating", () => {
  it("defaults to dry-run mode when mode is omitted, never live", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(baseOrder(), { spentTodaySoFarUsd: 0, config, walletClient, ledger });

    expect(entry.mode).toBe("dry-run");
    expect(entry.outcome).toBe("dry_run_only");
    expect(walletClient.dryRun).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("simulation mode never calls the wallet at all for an approved order", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, ledger },
      "simulation"
    );

    expect(entry.outcome).toBe("simulated");
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("live mode calls dryRun before send, in order", async () => {
    const calls: string[] = [];
    const walletClient: WalletClient = {
      dryRun: vi.fn().mockImplementation(async () => {
        calls.push("dryRun");
        return { outputUsd: 199, raw: {} };
      }),
      send: vi.fn().mockImplementation(async () => {
        calls.push("send");
        return { txId: "0xdeadbeef", raw: {} };
      }),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(baseOrder(), { spentTodaySoFarUsd: 0, config, walletClient, ledger }, "live");

    expect(calls).toEqual(["dryRun", "send"]);
    expect(entry.outcome).toBe("executed");
    expect(entry.send).toEqual({ txId: "0xdeadbeef" });
  });

  it("live mode never calls send when the fresh dry-run output falls below the floor", async () => {
    const walletClient = mockWalletClient({
      dryRun: vi.fn().mockResolvedValue({ outputUsd: 50, raw: {} }),
    });
    const ledger = new AuditLedger();

    const entry = await runPipeline(baseOrder(), { spentTodaySoFarUsd: 0, config, walletClient, ledger }, "live");

    expect(entry.outcome).toBe("dry_run_failed");
    expect(walletClient.send).not.toHaveBeenCalled();
  });
});

describe("runPipeline — every outcome produces exactly one ledger entry", () => {
  it("blocked: exactly one entry", async () => {
    const ledger = new AuditLedger();
    await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 1900, config, walletClient: mockWalletClient(), ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("blocked");
  });

  it("approved + dry-run-failed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient({ dryRun: vi.fn().mockResolvedValue({ outputUsd: 1, raw: {} }) });
    await runPipeline(baseOrder(), { spentTodaySoFarUsd: 0, config, walletClient, ledger }, "live");
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("dry_run_failed");
  });

  it("approved + executed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    await runPipeline(baseOrder(), { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), ledger }, "live");
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

    const entry = await runPipeline(order, { spentTodaySoFarUsd: 0, config, walletClient, ledger }, "dry-run");

    expect(entry.verdict.approved).toBe(true);
    expect(entry.outcome).toBe("dry_run_only");
    expect(walletClient.dryRun).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });
});
