import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { runPipeline, executeDirectSwap, applySlippageTolerance, type WalletClient, type FreshPoolPrices } from "./pipeline";
import { AuditLedger } from "./audit-ledger";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";
import type { ProposedOrder } from "../guardrails/check";
import { feeAdjustedPrice } from "../basis-model/nav-equivalent";
import { adjustedSpread } from "../basis-model/adjusted-spread";
import { V3_SWAP_ROUTER_ABI } from "../data/pancakeswap-v3";

const config = DEFAULT_GUARDRAIL_CONFIG;

// Real MSFTB pool addresses/fee tiers (lib/data/pool-addresses.ts) and the
// real stablecoin/target token addresses — buildDirectSwapParams() (the
// real, non-mocked function under indirect test here) resolves the target
// token from fresh.cheapPoolToken0/1 against BSC_USDT_ADDRESS, so these
// need to be the real addresses, not placeholders.
const STABLECOIN = "0x55d398326f99059fF775485246999027B3197955";
const TARGET_TOKEN = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";

const POOL_PAIR = {
  cheapPoolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea",
  cheapPoolFeeUnits: 2500,
  expensivePoolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44",
  expensivePoolFeeUnits: 10000,
};

const FLAT_GAS_USD = 200_000 * 1.5e-9 * 700; // the pipeline's default when no gas figure is passed

// SYNTHETIC prices, not a live reading — chosen only to produce a clean
// positive net edge (~+0.61%) so these tests can exercise the wiring and
// gates in isolation. The genuinely live, currently-declining reading is
// exercised separately below.
function prices(cheap: number, expensive: number): () => Promise<FreshPoolPrices> {
  return () =>
    Promise.resolve({
      cheapPoolPriceUsd: cheap,
      cheapPoolToken0: STABLECOIN,
      cheapPoolToken1: TARGET_TOKEN,
      expensivePoolPriceUsd: expensive,
      expensivePoolToken0: STABLECOIN,
      expensivePoolToken1: TARGET_TOKEN,
    } as FreshPoolPrices);
}

function netEdge(cheap: number, expensive: number): number {
  return adjustedSpread({
    effectiveBuyPriceUsd: feeAdjustedPrice(cheap, POOL_PAIR.cheapPoolFeeUnits, "buy"),
    effectiveSellPriceUsd: feeAdjustedPrice(expensive, POOL_PAIR.expensivePoolFeeUnits, "sell"),
    slippagePct: 0.0005,
    gasCostUsd: FLAT_GAS_USD,
    tradeSizeUsd: 200,
  });
}

const tenOf = (price: number) => Array.from({ length: 10 }, () => price);
const fetchFreshPoolPrices = prices(490, 500);

function baseOrder(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    ticker: "MSFT",
    side: "buy",
    sizeUsd: 200,
    adjustedSpread: netEdge(490, 500),
    price: 490,
    recentTicks: tenOf(490),
    expensivePrice: 500,
    expensiveRecentTicks: tenOf(500),
    liquidityDepthUsd: 5000,
    simulatedOutputUsd: null,
    poolPair: POOL_PAIR,
    // 0.25% above the cheap pool's spot price, well inside the 2% limit.
    reference: { status: "ok", priceUsd: 491.225, vendor: "LiquidMesh", route: "synthetic" },
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

// Bypasses unset TRADING_WALLET_PRIVATE_KEY/BSC_RPC_URL credentials.
const getWalletAddress = () => "0x1234567890123456789012345678901234567890";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    spentTodaySoFarUsd: 0,
    config,
    walletClient: mockWalletClient(),
    fetchFreshPoolPrices,
    getWalletAddress,
    ledger: new AuditLedger(),
    ...overrides,
  };
}

describe("runPipeline — blocked verdicts never reach the wallet or RPC", () => {
  it("does not call the wallet when the daily cap blocks the order", async () => {
    const walletClient = mockWalletClient();
    const entry = await runPipeline(baseOrder(), deps({ spentTodaySoFarUsd: 1900, walletClient }), "dry-run");

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("does not call the wallet when the order fails sanity/liquidity", async () => {
    const walletClient = mockWalletClient();
    const entry = await runPipeline(baseOrder({ liquidityDepthUsd: 1 }), deps({ walletClient }), "dry-run");

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("blocks during price-history warm-up, before any re-read or wallet call", async () => {
    const walletClient = mockWalletClient();
    const fresh = vi.fn(fetchFreshPoolPrices);
    const entry = await runPipeline(baseOrder({ recentTicks: tenOf(490).slice(0, 3) }), deps({ walletClient, fetchFreshPoolPrices: fresh }), "dry-run");

    expect(entry.outcome).toBe("blocked");
    expect(entry.verdict.checks.find((c) => c.name === "sanityAndLiquidity")?.warmingUp).toBe(true);
    expect(fresh).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("blocks a price spike on either pool", async () => {
    const entry = await runPipeline(baseOrder({ expensivePrice: 560 }), deps(), "dry-run");
    expect(entry.outcome).toBe("blocked");
    expect(entry.verdict.reason).toContain("expensive pool");
  });
});

describe("runPipeline — live mode refuses single-leg arbitrage", () => {
  it("an otherwise-clean order fails closed as two_leg_execution_not_implemented, with no re-read, approval, simulation, or send", async () => {
    const walletClient = mockWalletClient();
    const fresh = vi.fn(fetchFreshPoolPrices);
    const entry = await runPipeline(baseOrder(), deps({ walletClient, fetchFreshPoolPrices: fresh }), "live");

    expect(entry.verdict.approved).toBe(true);
    expect(entry.outcome).toBe("two_leg_execution_not_implemented");
    expect(fresh).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("live mode can never send a single leg, across every wallet state", async () => {
    const scenarios: Partial<WalletClient>[] = [
      {},
      { checkAllowance: vi.fn().mockResolvedValue({ sufficient: false, currentAllowance: 0n, approveTransaction: { to: "0xToken", data: "0xapprove" } }) },
      { simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 50, amountOut: 1n, gasEstimate: 1n }) },
      { send: vi.fn().mockRejectedValue(new Error("would fail anyway")) },
    ];
    for (const overrides of scenarios) {
      const walletClient = mockWalletClient(overrides);
      const entry = await runPipeline(baseOrder(), deps({ walletClient }), "live");
      expect(["two_leg_execution_not_implemented", "blocked", "no_edge", "tolerance_exceeds_edge"]).toContain(entry.outcome);
      expect(walletClient.send).not.toHaveBeenCalled();
    }
  });

  it("guardrail blocks still come first in live mode", async () => {
    const entry = await runPipeline(baseOrder({ sizeUsd: 1000 }), deps(), "live");
    expect(entry.outcome).toBe("blocked");
    expect(entry.verdict.blockedBy).toBe("perTradeCap");
  });
});

describe("runPipeline — mode gating (dry-run and simulation unchanged)", () => {
  it("defaults to dry-run mode when mode is omitted, never live", async () => {
    const walletClient = mockWalletClient();
    const entry = await runPipeline(baseOrder(), deps({ walletClient }));

    expect(entry.mode).toBe("dry-run");
    expect(entry.outcome).toBe("dry_run_only");
    expect(walletClient.checkAllowance).toHaveBeenCalledTimes(1);
    expect(walletClient.simulateSwap).toHaveBeenCalledTimes(1);
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("simulation mode never calls the wallet or fetches fresh prices", async () => {
    const walletClient = mockWalletClient();
    const fresh = vi.fn(fetchFreshPoolPrices);
    const entry = await runPipeline(baseOrder(), deps({ walletClient, fetchFreshPoolPrices: fresh }), "simulation");

    expect(entry.outcome).toBe("simulated");
    expect(fresh).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("dry-run mode never sends even when an approval is needed", async () => {
    const walletClient = mockWalletClient({
      checkAllowance: vi.fn().mockResolvedValue({ sufficient: false, currentAllowance: 0n, approveTransaction: { to: "0xToken", data: "0xapprove" } }),
    });
    const entry = await runPipeline(baseOrder(), deps({ walletClient }));

    expect(entry.outcome).toBe("dry_run_only");
    expect(entry.approval).toEqual({ needed: true });
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("dry-run stops as dry_run_failed when the real simulated output falls below the floor", async () => {
    const walletClient = mockWalletClient({
      simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 50, amountOut: 50_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    });
    const entry = await runPipeline(baseOrder(), deps({ walletClient }));

    expect(entry.outcome).toBe("dry_run_failed");
    expect(entry.dryRun?.reason).toContain("floor");
  });
});

describe("runPipeline — spreadFreshnessCheck (MEV/front-running mitigation)", () => {
  it("blocks as spread_closed when the edge decayed below the retention floor", async () => {
    const walletClient = mockWalletClient();
    // Detected spread inflated to 3x the fresh value: ~33% retention, floor is 50%.
    const entry = await runPipeline(baseOrder({ adjustedSpread: netEdge(490, 500) * 3 }), deps({ walletClient }), "dry-run");

    expect(entry.outcome).toBe("spread_closed");
    expect(entry.freshness?.ok).toBe(false);
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("blocks as spread_closed when the edge has inverted", async () => {
    // Synthetic fresh prices: the cheap pool is now above the expensive one.
    const entry = await runPipeline(baseOrder(), deps({ fetchFreshPoolPrices: prices(510, 500) }), "dry-run");

    expect(entry.outcome).toBe("spread_closed");
    expect(entry.freshness?.reason).toContain("no longer positive");
  });
});

describe("runPipeline — on-chain slippage tolerance vs the edge", () => {
  it("refuses an order whose detected edge isn't above the tolerance, before any re-read", async () => {
    const fresh = vi.fn(fetchFreshPoolPrices);
    const entry = await runPipeline(baseOrder({ adjustedSpread: config.sendSlippageTolerance }), deps({ fetchFreshPoolPrices: fresh }), "dry-run");

    expect(entry.outcome).toBe("tolerance_exceeds_edge");
    expect(fresh).not.toHaveBeenCalled();
  });

  it("refuses in simulation mode too, so an unprotectable edge is never reported as simulated", async () => {
    const entry = await runPipeline(baseOrder({ adjustedSpread: 0.0003 }), deps(), "simulation");
    expect(entry.outcome).toBe("tolerance_exceeds_edge");
  });

  it("refuses when the FRESH edge has decayed under the tolerance while still passing the retention floor", async () => {
    const looser = { ...config, sendSlippageTolerance: 0.004 };
    const detected = netEdge(490, 500);
    const fresh = netEdge(491.3, 500);
    expect(detected).toBeGreaterThan(0.004); // detected edge is above tolerance
    expect(fresh / detected).toBeGreaterThanOrEqual(0.5); // still passes spreadFreshness
    expect(fresh).toBeLessThan(0.004); // but the fresh edge isn't

    const walletClient = mockWalletClient();
    const entry = await runPipeline(baseOrder(), deps({ config: looser, walletClient, fetchFreshPoolPrices: prices(491.3, 500) }), "dry-run");

    expect(entry.outcome).toBe("tolerance_exceeds_edge");
    expect(entry.freshness?.ok).toBe(true);
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
  });

  it("applySlippageTolerance takes exactly the tolerance off the simulated output", () => {
    expect(applySlippageTolerance(1_000_000n, 0.0005)).toBe(999_500n);
    expect(applySlippageTolerance(199_000_000_000_000_000_000n, 0.0005)).toBe(198_900_500_000_000_000_000n);
  });
});

describe("executeDirectSwap — the built, unwired single-leg send path", () => {
  it("calls checkAllowance, then simulateSwap, then send, in order, when no approval is needed", async () => {
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

    const entry = await executeDirectSwap(baseOrder(), deps({ walletClient }));

    expect(calls).toEqual(["checkAllowance", "simulateSwap", "send"]);
    expect(entry.outcome).toBe("executed");
    expect(entry.approval).toEqual({ needed: false });
    expect(entry.send).toEqual({ txId: "0xdeadbeef" });
  });

  it("sends the approval first when one is needed", async () => {
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
        calls.push(tx.data === "0xapprove" ? "send:approve" : "send:swap");
        return { txId: tx.data === "0xapprove" ? "0xapprovaltx" : "0xswaptx" };
      }),
    };

    const entry = await executeDirectSwap(baseOrder(), deps({ walletClient }));

    expect(calls).toEqual(["checkAllowance", "send:approve", "simulateSwap", "send:swap"]);
    expect(entry.approval).toEqual({ needed: true, txId: "0xapprovaltx" });
    expect(entry.send).toEqual({ txId: "0xswaptx" });
  });

  it("stops as approval_failed if the approval can't be sent, and never simulates or swaps", async () => {
    const walletClient: WalletClient = {
      checkAllowance: vi.fn().mockResolvedValue({ sufficient: false, currentAllowance: 0n, approveTransaction: { to: "0xToken", data: "0xapprove" } }),
      simulateSwap: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error("insufficient gas")),
    };

    const entry = await executeDirectSwap(baseOrder(), deps({ walletClient }));

    expect(entry.outcome).toBe("approval_failed");
    expect(entry.approval).toEqual({ needed: true, error: "insufficient gas" });
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
  });

  it("never sends the swap when the simulated output falls below the floor", async () => {
    const walletClient = mockWalletClient({
      simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 50, amountOut: 50_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    });
    const entry = await executeDirectSwap(baseOrder(), deps({ walletClient }));

    expect(entry.outcome).toBe("dry_run_failed");
    expect(walletClient.send).not.toHaveBeenCalled();
  });

  it("sets the swap's amountOutMinimum to the simulated output less the configured tolerance", async () => {
    let swapData: string | undefined;
    const walletClient = mockWalletClient({
      send: vi.fn().mockImplementation(async (tx) => {
        swapData = tx.data;
        return { txId: "0xswaptx" };
      }),
    });

    await executeDirectSwap(baseOrder(), deps({ walletClient }));

    const decoded = decodeFunctionData({ abi: V3_SWAP_ROUTER_ABI, data: swapData as `0x${string}` });
    expect(decoded.args[0].amountOutMinimum).toBe(applySlippageTolerance(199_000_000_000_000_000_000n, config.sendSlippageTolerance));
  });

  it("still runs every gate first: a guardrail block never reaches the wallet", async () => {
    const walletClient = mockWalletClient();
    const entry = await executeDirectSwap(baseOrder({ sizeUsd: 1000 }), deps({ walletClient }));

    expect(entry.outcome).toBe("blocked");
    expect(walletClient.send).not.toHaveBeenCalled();
  });
});

describe("runPipeline — every outcome produces exactly one ledger entry", () => {
  const cases: Array<[string, Partial<ProposedOrder>, Record<string, unknown>, "dry-run" | "live" | "simulation"]> = [
    ["blocked", {}, { spentTodaySoFarUsd: 1900 }, "dry-run"],
    ["no_edge", { adjustedSpread: -0.01 }, {}, "dry-run"],
    ["tolerance_exceeds_edge", { adjustedSpread: 0.0003 }, {}, "dry-run"],
    ["simulated", {}, {}, "simulation"],
    ["two_leg_execution_not_implemented", {}, {}, "live"],
    ["spread_closed", { adjustedSpread: netEdge(490, 500) * 3 }, {}, "dry-run"],
    ["dry_run_only", {}, {}, "dry-run"],
  ];

  for (const [outcome, orderOverrides, depOverrides, mode] of cases) {
    it(`${outcome}: exactly one entry`, async () => {
      const ledger = new AuditLedger();
      await runPipeline(baseOrder(orderOverrides), deps({ ...depOverrides, ledger }), mode);
      expect(ledger.readAll()).toHaveLength(1);
      expect(ledger.readAll()[0]?.outcome).toBe(outcome);
    });
  }
});

describe("runPipeline — the real, live MSFTB scenario as of 2026-09-24", () => {
  it("an order built from the current live reading stops as no_edge, never reaching the re-read or wallet", async () => {
    // Both real registered MSFTB pools, read live on 2026-09-24: 0.25%
    // pool $496.3821, 1% pool $496.9976. About -1.28% net with the flat
    // $0.21 gas used at the time. Re-reading the pools now will give a
    // different number. The automatic loop would never build this order
    // (see agent-loop.test.ts); this is what a manual instruction gets.
    const liveEdge = netEdge(496.3821, 496.9976);
    expect(liveEdge).toBeCloseTo(-0.0128, 3);

    const walletClient = mockWalletClient();
    const fresh = vi.fn(prices(496.3821, 496.9976));
    const ledger = new AuditLedger();
    const entry = await runPipeline(
      baseOrder({ adjustedSpread: liveEdge, price: 496.3821, recentTicks: tenOf(496.3821), expensivePrice: 496.9976, expensiveRecentTicks: tenOf(496.9976) }),
      deps({ walletClient, fetchFreshPoolPrices: fresh, ledger }),
      "dry-run"
    );

    expect(entry.verdict.approved).toBe(true);
    expect(entry.outcome).toBe("no_edge");
    expect(fresh).not.toHaveBeenCalled();
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });
});

describe("runPipeline — detection snapshot pass-through", () => {
  it("carries a detection snapshot onto the entry when one is supplied", async () => {
    const detection = {
      ticker: "MSFT",
      cheapPool: { address: POOL_PAIR.cheapPoolAddress, feeUnits: 2500, priceUsd: 490 },
      expensivePool: { address: POOL_PAIR.expensivePoolAddress, feeUnits: 10000, priceUsd: 500 },
      grossGap: (500 - 490) / 490,
      netEdge: netEdge(490, 500),
      threshold: 0.0001,
      gas: { costUsd: FLAT_GAS_USD, source: "fallback" as const },
      reference: { status: "ok" as const, priceUsd: 491.225, vendor: "LiquidMesh", route: "synthetic" },
    };
    const entry = await runPipeline(baseOrder(), deps({ detection }), "dry-run");
    expect(entry.kind).toBe("pipeline");
    expect(entry.detection).toEqual(detection);
  });
});
