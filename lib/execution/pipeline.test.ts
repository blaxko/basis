import { describe, it, expect, vi } from "vitest";
import { runPipeline, type WalletClient, type FreshPoolPrices } from "./pipeline";
import { AuditLedger } from "./audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { ProposedOrder } from "../guardrails/check";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";

const config = DEFAULT_GUARDRAIL_CONFIG;

// Real MSFTB pool addresses/fee tiers (lib/data/pool-addresses.ts) and the
// real stablecoin/target token addresses (lib/data/quotes.ts's
// BSC_USDT_ADDRESS, the real MSFTB contract) — buildDirectSwapParams()
// (the real, non-mocked function under indirect test here) resolves the
// target token from fresh.cheapPoolToken0/1 against BSC_USDT_ADDRESS, so
// these need to be the real addresses, not placeholders.
const STABLECOIN = "0x55d398326f99059fF775485246999027B3197955";
const TARGET_TOKEN = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";

const POOL_PAIR = {
  cheapPoolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea",
  cheapPoolFeeUnits: 2500,
  expensivePoolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44",
  expensivePoolFeeUnits: 10000,
};

// SYNTHETIC prices, not a live reading — chosen only to produce a clean
// positive net edge so these tests can exercise the allowance/simulate/
// send wiring, mode gating, and floor/retention math in isolation. The
// real pool addresses/fee tiers above are still used (buildDirectSwapParams()
// needs the real target-token address to resolve correctly), but the
// PRICES here don't correspond to any real reading and shouldn't be
// quoted as one. The genuinely live, currently-declining reading is
// exercised separately below in "runPipeline — the real, live MSFTB
// scenario as of 2026-09-24".
function freshPrices(): FreshPoolPrices {
  return {
    cheapPoolPriceUsd: 490,
    cheapPoolToken0: STABLECOIN,
    cheapPoolToken1: TARGET_TOKEN,
    expensivePoolPriceUsd: 500,
    expensivePoolToken0: STABLECOIN,
    expensivePoolToken1: TARGET_TOKEN,
  } as FreshPoolPrices;
}

function detectedAdjustedSpread(): number {
  const effectiveBuyPriceUsd = feeAdjustedPrice(490, POOL_PAIR.cheapPoolFeeUnits, "buy");
  const effectiveSellPriceUsd = feeAdjustedPrice(500, POOL_PAIR.expensivePoolFeeUnits, "sell");
  return adjustedSpread({
    effectiveBuyPriceUsd,
    effectiveSellPriceUsd,
    slippagePct: 0.0005,
    gasCostUsd: 200_000 * 1.5e-9 * 700,
    tradeSizeUsd: 200,
  });
}

function baseOrder(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    ticker: "MSFT",
    side: "buy",
    sizeUsd: 200,
    adjustedSpread: detectedAdjustedSpread(),
    price: 490,
    recentTicks: [488, 489, 490],
    liquidityDepthUsd: 5000,
    simulatedOutputUsd: 199,
    poolPair: POOL_PAIR,
    ...overrides,
  };
}

function mockWalletClient(overrides: Partial<WalletClient> = {}): WalletClient {
  return {
    checkAllowance: vi.fn().mockResolvedValue({ sufficient: true, currentAllowance: 10n ** 30n }),
    simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
    ...overrides,
  };
}

const fetchFreshPoolPrices = () => Promise.resolve(freshPrices());
// Bypasses unset TRADING_WALLET_PRIVATE_KEY/BSC_RPC_URL credentials —
// these tests exercise the pipeline's own control flow, not real wallet
// derivation.
const getWalletAddress = () => "0x1234567890123456789012345678901234567890";

describe("runPipeline — blocked verdicts never reach the wallet or RPC", () => {
  it("does not call checkAllowance/simulateSwap/send when the daily cap blocks the order", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 1900, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("does not call checkAllowance/simulateSwap/send when the order fails sanity/liquidity, even in live mode", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder({ liquidityDepthUsd: 1 }),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });
});

describe("runPipeline — spreadFreshnessCheck (MEV/front-running mitigation)", () => {
  it("blocks as spread_closed when the fresh re-read shows the edge decayed below the retention floor", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    // Detected spread is inflated to 3x the real fresh value below, so
    // fresh-vs-detected retention is ~33%, under the default 50% floor.
    const order = baseOrder({ adjustedSpread: detectedAdjustedSpread() * 3 });

    const entry = await runPipeline(order, { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger }, "live");

    expect(entry.outcome).toBe("spread_closed");
    expect(entry.freshness?.ok).toBe(false);
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("blocks as spread_closed when the fresh re-read shows the edge has inverted to negative", async () => {
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    // Synthetic fresh prices (not a live reading) where the cheap pool is
    // now MORE expensive than the "expensive" pool — the edge has fully
    // inverted since detection.
    const invertedFresh = () =>
      Promise.resolve({
        cheapPoolPriceUsd: 510,
        cheapPoolToken0: STABLECOIN,
        cheapPoolToken1: TARGET_TOKEN,
        expensivePoolPriceUsd: 500,
        expensivePoolToken0: STABLECOIN,
        expensivePoolToken1: TARGET_TOKEN,
      } as FreshPoolPrices);

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices: invertedFresh, ledger },
      "live"
    );

    expect(entry.outcome).toBe("spread_closed");
    expect(entry.freshness?.reason).toContain("no longer positive");
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
      fetchFreshPoolPrices,
      getWalletAddress,
      ledger,
    });

    expect(entry.mode).toBe("dry-run");
    expect(entry.outcome).toBe("dry_run_only");
    expect(walletClient.checkAllowance).toHaveBeenCalledTimes(1);
    expect(walletClient.simulateSwap).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("simulation mode never calls the wallet or fetches fresh prices at all for an approved order", async () => {
    const walletClient = mockWalletClient();
    const fetchFreshPoolPricesSpy = vi.fn().mockResolvedValue(freshPrices());
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices: fetchFreshPoolPricesSpy, ledger },
      "simulation"
    );

    expect(entry.outcome).toBe("simulated");
    expect(fetchFreshPoolPricesSpy).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("live mode calls checkAllowance, then simulateSwap, then send, in order, when no approval is needed", async () => {
    const calls: string[] = [];
    const walletClient: WalletClient = {
      checkAllowance: vi.fn().mockImplementation(async () => {
        calls.push("checkAllowance");
        return { sufficient: true, currentAllowance: 10n ** 30n };
      }),
      simulateSwap: vi.fn().mockImplementation(async () => {
        calls.push("simulateSwap");
        return { outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n };
      }),
      send: vi.fn().mockImplementation(async () => {
        calls.push("send");
        return { txId: "0xdeadbeef", raw: {} };
      }),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );

    expect(calls).toEqual(["checkAllowance", "simulateSwap", "send"]);
    expect(entry.outcome).toBe("executed");
    expect(entry.approval).toEqual({ needed: false });
    expect(entry.send).toEqual({ txId: "0xdeadbeef" });
  });

  it("live mode sends the approval transaction first when one is needed, before simulateSwap/send", async () => {
    const calls: string[] = [];
    const walletClient: WalletClient = {
      checkAllowance: vi.fn().mockImplementation(async () => {
        calls.push("checkAllowance");
        return { sufficient: false, currentAllowance: 0n, approveTransaction: { to: "0xToken", data: "0xapprove" } };
      }),
      simulateSwap: vi.fn().mockImplementation(async () => {
        calls.push("simulateSwap");
        return { outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n };
      }),
      send: vi.fn().mockImplementation(async (tx) => {
        // The approval tx is the fixed "0xapprove" stub above; the swap
        // tx is real calldata from buildExactInputSingleTransaction() —
        // distinguish by that, not by asserting its exact bytes (which
        // depend on amountIn/deadline/etc., not what this test is about).
        calls.push(tx.data === "0xapprove" ? "send:approve" : "send:swap");
        return { txId: tx.data === "0xapprove" ? "0xapprovaltx" : "0xswaptx" };
      }),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );

    expect(calls).toEqual(["checkAllowance", "send:approve", "simulateSwap", "send:swap"]);
    expect(entry.outcome).toBe("executed");
    expect(entry.approval).toEqual({ needed: true, txId: "0xapprovaltx" });
    expect(entry.send).toEqual({ txId: "0xswaptx" });
  });

  it("live mode stops with approval_failed if the approval transaction can't be sent, and never reaches simulateSwap/the swap send", async () => {
    const walletClient: WalletClient = {
      checkAllowance: vi.fn().mockResolvedValue({
        sufficient: false,
        currentAllowance: 0n,
        approveTransaction: { to: "0xToken", data: "0xapprove" },
      }),
      simulateSwap: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error("insufficient gas")),
    };
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );

    expect(entry.outcome).toBe("approval_failed");
    expect(entry.approval).toEqual({ needed: true, error: "insufficient gas" });
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
  });

  it("dry-run mode never sends even when an approval is needed", async () => {
    const walletClient = mockWalletClient({
      checkAllowance: vi.fn().mockResolvedValue({
        sufficient: false,
        currentAllowance: 0n,
        approveTransaction: { to: "0xToken", data: "0xapprove" },
      }),
    });
    const ledger = new AuditLedger();

    const entry = await runPipeline(baseOrder(), {
      spentTodaySoFarUsd: 0,
      config,
      walletClient,
      fetchFreshPoolPrices,
      getWalletAddress,
      ledger,
    });

    expect(entry.mode).toBe("dry-run");
    expect(entry.outcome).toBe("dry_run_only");
    expect(entry.approval).toEqual({ needed: true });
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("live mode never calls send for the swap when the fresh simulation output falls below the floor", async () => {
    const walletClient = mockWalletClient({
      simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 50, amountOut: 50_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    });
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
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
      { spentTodaySoFarUsd: 1900, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("blocked");
  });

  it("spread_closed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    await runPipeline(
      baseOrder({ adjustedSpread: detectedAdjustedSpread() * 3 }),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("spread_closed");
  });

  it("approved + dry-run-failed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    const walletClient = mockWalletClient({
      simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 1, amountOut: 1_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    });
    await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("dry_run_failed");
  });

  it("approved + executed: exactly one entry", async () => {
    const ledger = new AuditLedger();
    await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, ledger },
      "live"
    );
    expect(ledger.readAll()).toHaveLength(1);
    expect(ledger.readAll()[0]?.outcome).toBe("executed");
  });
});

describe("runPipeline — the real, live MSFTB scenario as of 2026-09-24", () => {
  it("an order built from the current live reading stops as no_edge, never reaching the re-read, allowance, simulation, or send", async () => {
    // Both real, registered MSFTB pools (lib/data/pool-addresses.ts),
    // read live via a public BSC RPC on 2026-09-24: 0.25% pool $496.3821,
    // 1% pool $496.9976. Re-reading these two addresses now will very
    // likely give a different number — real BSC pool prices move (see
    // lib/data/demo-history.ts's note on 0.3-1.6% intrahour volatility
    // for this exact pool set) — but as of this reading, net of real
    // fees+slippage+gas, this pairing is about -1.28%: NOT a clearing
    // edge. This is the current demo baseline: the only pairing in this
    // codebase with a live-reproducible number, and it correctly declines.
    const liveCheapPriceUsd = 496.3821;
    const liveExpensivePriceUsd = 496.9976;
    const liveFreshPoolPrices = () =>
      Promise.resolve({
        cheapPoolPriceUsd: liveCheapPriceUsd,
        cheapPoolToken0: STABLECOIN,
        cheapPoolToken1: TARGET_TOKEN,
        expensivePoolPriceUsd: liveExpensivePriceUsd,
        expensivePoolToken0: STABLECOIN,
        expensivePoolToken1: TARGET_TOKEN,
      } as FreshPoolPrices);

    const liveAdjustedSpread = adjustedSpread({
      effectiveBuyPriceUsd: feeAdjustedPrice(liveCheapPriceUsd, POOL_PAIR.cheapPoolFeeUnits, "buy"),
      effectiveSellPriceUsd: feeAdjustedPrice(liveExpensivePriceUsd, POOL_PAIR.expensivePoolFeeUnits, "sell"),
      slippagePct: 0.0005,
      gasCostUsd: 200_000 * 1.5e-9 * 700,
      tradeSizeUsd: 200,
    });
    expect(liveAdjustedSpread).toBeCloseTo(-0.0128, 3);

    const order = baseOrder({ adjustedSpread: liveAdjustedSpread, price: liveCheapPriceUsd });
    const walletClient = mockWalletClient();
    const fetchFreshPoolPricesSpy = vi.fn(liveFreshPoolPrices);
    const ledger = new AuditLedger();

    const entry = await runPipeline(
      order,
      { spentTodaySoFarUsd: 0, config, walletClient, fetchFreshPoolPrices: fetchFreshPoolPricesSpy, getWalletAddress, ledger },
      "dry-run"
    );

    // check() doesn't gate on spread sign, so the verdict is approved; the
    // no_edge gate right after it declines. The automatic loop would never
    // have built this order (see agent-loop.test.ts); this is what a manual
    // instruction against the live reading gets.
    expect(entry.verdict.approved).toBe(true);
    expect(entry.outcome).toBe("no_edge");
    expect(entry.freshness).toBeUndefined();
    expect(fetchFreshPoolPricesSpy).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });
});

describe("runPipeline — no_edge gate", () => {
  it("a zero net edge is not an edge", async () => {
    const entry = await runPipeline(
      baseOrder({ adjustedSpread: 0 }),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, ledger: new AuditLedger() },
      "live"
    );
    expect(entry.outcome).toBe("no_edge");
  });

  it("applies in simulation mode too, so a non-positive edge is never reported as simulated", async () => {
    const entry = await runPipeline(
      baseOrder({ adjustedSpread: -0.01 }),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, ledger: new AuditLedger() },
      "simulation"
    );
    expect(entry.outcome).toBe("no_edge");
  });

  it("runs after the guardrails: an oversized non-positive-edge order is still a guardrail block", async () => {
    const entry = await runPipeline(
      baseOrder({ adjustedSpread: -0.01, sizeUsd: 5000, simulatedOutputUsd: 5000 }),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, ledger: new AuditLedger() },
      "live"
    );
    expect(entry.outcome).toBe("blocked");
    expect(entry.verdict.blockedBy).toBe("perTradeCap");
  });

  it("carries a detection snapshot onto the entry when one is supplied", async () => {
    const detection = {
      ticker: "MSFT",
      cheapPool: { address: POOL_PAIR.cheapPoolAddress, feeUnits: 2500, priceUsd: 490 },
      expensivePool: { address: POOL_PAIR.expensivePoolAddress, feeUnits: 10000, priceUsd: 500 },
      grossGap: (500 - 490) / 490,
      netEdge: detectedAdjustedSpread(),
      threshold: 0.0001,
    };
    const entry = await runPipeline(
      baseOrder(),
      { spentTodaySoFarUsd: 0, config, walletClient: mockWalletClient(), fetchFreshPoolPrices, getWalletAddress, detection, ledger: new AuditLedger() },
      "dry-run"
    );
    expect(entry.kind).toBe("pipeline");
    expect(entry.detection).toEqual(detection);
  });
});
