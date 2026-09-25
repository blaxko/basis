import { describe, it, expect, vi } from "vitest";
import { handleInstruction } from "./handle-instruction";
import { DailySpendTracker } from "./spend-tracker";
import { AuditLedger } from "../execution/audit-ledger";
import { BoundedPriceHistory } from "../data/price-history";
import type { PoolQuote } from "../data/types";
import type { WalletClient, FreshPoolPrices } from "../execution/pipeline";
import type { EstimateGasFn, FetchReferenceFn, FetchMarketStatusFn } from "./agent-loop";
import type { chatCompletion, GroqChatResult } from "../llm/groq-client";

const POOL_025 = "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea";
const POOL_1 = "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44";

// Gas pinned to the old flat $0.21 so the documented −1.28% stays
// reproducible; the live estimator has its own tests.
const pinnedGas: EstimateGasFn = async () => ({ gasCostUsd: 200_000 * 1.5e-9 * 700, source: "fallback" });

// A Binance reference 0.25% above the cheap pool's spot price
// (496.3821 × 1.0025) — well inside the 2% limit.
const agreeingReference = () =>
  vi.fn<FetchReferenceFn>(async () => ({ status: "ok", priceUsd: 497.6231, vendor: "LiquidMesh", route: "stub" }));

// What the scheduler would have recorded after `count` ticks.
function historyWith(count: number): BoundedPriceHistory {
  const history = new BoundedPriceHistory();
  for (let i = 0; i < count; i++) {
    history.record(POOL_025, 496.3821);
    history.record(POOL_1, 496.9976);
  }
  return history;
}

// Both real, registered MSFTB pools (lib/data/pool-addresses.ts), read
// LIVE via a public BSC RPC on 2026-09-24 — same reading as
// lib/orchestration/agent-loop.test.ts's fixture. Re-reading these two
// addresses now will very likely give a different figure (real BSC pool
// prices move), which is why this is labeled with its read date rather
// than presented as a permanent fact.
function msftPoolQuotes(): PoolQuote[] {
  const timestamp = Date.now();
  return [
    { ticker: "MSFT", poolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 496.3821, liquidityUsdEstimate: 50_000, timestamp },
    { ticker: "MSFT", poolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: 496.9976, liquidityUsdEstimate: 50_000, timestamp },
  ];
}

function mockChat(result: GroqChatResult): typeof chatCompletion {
  return vi.fn().mockResolvedValue(result) as unknown as typeof chatCompletion;
}

function mockWalletClient(): WalletClient {
  return {
    checkAllowance: vi.fn().mockResolvedValue({ sufficient: true, currentAllowance: 10n ** 30n }),
    simulateSwap: vi.fn().mockResolvedValue({ outputUsd: 199, amountOut: 199_000_000_000_000_000_000n, gasEstimate: 150_000n }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
    simulateWithBinance: vi.fn().mockResolvedValue({ result: "succeeded", status: "SUCCESS", balanceChanges: [], allowanceChanges: [] }),
  };
}

const FAKE_STABLECOIN = "0x55d398326f99059fF775485246999027B3197955";
const FAKE_TARGET_TOKEN = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0"; // real MSFTB address

// Stand in for pipeline.ts's real on-chain freshness re-read, same
// reasoning as lib/orchestration/agent-loop.test.ts. Matches
// msftPoolQuotes() above exactly, so "detected" and "fresh" agree.
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


// The real statusInfo shape for MSFTB, 2026-09-25 12:06 UTC (docs/devex-log.md).
function tradingStatus(): FetchMarketStatusFn {
  return vi.fn(async () => ({ status: "ok" as const, openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "2026-09-25T12:06:16.554Z" }));
}

describe("handleInstruction — a malformed instruction never reaches pool resolution or runPipeline()", () => {
  it("returns a typed parse error and never touches the wallet or the ledger, for a hallucinated ticker", async () => {
    const chatCompletionFn = mockChat({ ok: true, content: '{"ticker":"GOOG","side":"buy","sizeUsd":100}' });
    const fetchPoolQuotesFn = vi.fn();
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy some google", {
      chatCompletionFn,
      fetchPoolQuotesFn,
      walletClient,
      ledger,
      spendTracker: new DailySpendTracker(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema_validation");
    }
    expect(fetchPoolQuotesFn).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });

  it("returns a typed parse error and never touches the wallet, for a non-JSON Groq response", async () => {
    const chatCompletionFn = mockChat({ ok: true, content: "sure, buying some NVDA for you!" });
    const fetchPoolQuotesFn = vi.fn();
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy nvda", {
      chatCompletionFn,
      fetchPoolQuotesFn,
      walletClient,
      ledger,
      spendTracker: new DailySpendTracker(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_json");
    }
    expect(fetchPoolQuotesFn).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });
});

describe("handleInstruction — a valid intent with no resolvable pool pair is a typed rejection, not a partial order", () => {
  it("returns pool_resolution_failed and never reaches runPipeline() when the ticker has no registered pools", async () => {
    // NVDA parses fine (it's in MVP_UNDERLYINGS), but lib/data/pool-addresses.ts
    // only has MSFT registered — getPoolsForTicker() throws NotImplemented,
    // which computeSpreads() propagates. This proves the resolution step
    // converts that into a typed rejection rather than letting it throw
    // uncaught or falling through to an incomplete order.
    const chatCompletionFn = mockChat({ ok: true, content: '{"ticker":"NVDA","side":"buy","sizeUsd":100}' });
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy 100 dollars of nvda", {
      chatCompletionFn,
      walletClient,
      ledger,
      spendTracker: new DailySpendTracker(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("pool_resolution_failed");
      if (result.error.kind === "pool_resolution_failed") {
        expect(result.error.ticker).toBe("NVDA");
      }
    }
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });
});

describe("handleInstruction — valid instruction composes to a correctly-declined pipeline run", () => {
  it("sources market data and poolPair independently, never trusting numeric fields from the LLM", async () => {
    // The LLM response includes an extra "price" field it was never asked
    // for — zod's schema strips it, and the order construction below
    // sources price/poolPair from computeSpreads() regardless, not from this.
    const chatCompletionFn = mockChat({
      ok: true,
      content: '{"ticker":"MSFT","side":"buy","sizeUsd":200,"price":1}',
    });
    const fetchPoolQuotesFn = vi.fn().mockResolvedValue(msftPoolQuotes());
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy 200 dollars of msft", {
      chatCompletionFn,
      fetchPoolQuotesFn,
      estimateGasFn: pinnedGas,
      fetchReferenceFn: agreeingReference(),
      fetchMarketStatusFn: tradingStatus(),
      priceHistory: historyWith(10),
      walletClient,
      fetchFreshPoolPrices: fakeFetchFreshPoolPrices,
      getWalletAddress: () => "0x1234567890123456789012345678901234567890",
      ledger,
      getMode: () => "live",
      spendTracker: new DailySpendTracker(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.price).toBe(496.3821); // sourced from the mocked pool quote, not the LLM's "price": 1
      expect(result.order.sizeUsd).toBe(200);
      expect(result.order.poolPair.cheapPoolAddress).toBe("0x5018b018ceb7645c927c5cf246786f89ebcbe7ea");
      expect(result.order.poolPair.expensivePoolAddress).toBe("0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44");
      // Guardrails approve the request; the live net edge (-1.28%) isn't
      // positive, so the pipeline stops as no_edge before any re-read or
      // wallet call. Not spread_closed — nothing decayed; it was never positive.
      expect(result.outcome).toBe("no_edge");
      expect(result.verdict.approved).toBe(true);
    }
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    expect(walletClient.simulateSwap).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });

  it("demo moment B: a $1,000 request is blocked by the per-trade cap alone, even when there's no edge", async () => {
    // The real default per-trade cap is $500 and daily cap $2,000
    // (lib/guardrails/config.ts), so $1,000 fails only the per-trade cap.
    const chatCompletionFn = mockChat({ ok: true, content: '{"ticker":"MSFT","side":"buy","sizeUsd":1000}' });
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy 1000 dollars of msft", {
      chatCompletionFn,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(msftPoolQuotes()),
      estimateGasFn: pinnedGas,
      fetchReferenceFn: agreeingReference(),
      fetchMarketStatusFn: tradingStatus(),
      priceHistory: historyWith(10),
      walletClient,
      fetchFreshPoolPrices: fakeFetchFreshPoolPrices,
      getWalletAddress: () => "0x1234567890123456789012345678901234567890",
      ledger,
      getMode: () => "live",
      spendTracker: new DailySpendTracker(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("blocked");
      expect(result.verdict.blockedBy).toBe("perTradeCap");
      expect(result.verdict.reason).toContain("exceeds per-trade cap $500");
      const failed = result.verdict.checks.filter((c) => !c.ok).map((c) => c.name);
      expect(failed).toEqual(["perTradeCap"]);
      expect(result.verdict.checks.find((c) => c.name === "dryRunFloor")?.pending).toBe(true);
    }
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(1);
  });
});

describe("handleInstruction — Binance reference price", () => {
  const base = () => ({
    fetchPoolQuotesFn: vi.fn().mockResolvedValue(msftPoolQuotes()),
    estimateGasFn: pinnedGas,
    priceHistory: historyWith(10),
    walletClient: mockWalletClient(),
    fetchFreshPoolPrices: fakeFetchFreshPoolPrices,
    getWalletAddress: () => "0x1234567890123456789012345678901234567890",
    ledger: new AuditLedger(),
    spendTracker: new DailySpendTracker(),
  });

  it("fetches the reference at the instruction's own size", async () => {
    const fetchReferenceFn = agreeingReference();
    await handleInstruction("buy 300 dollars of msft", {
      ...base(),
      chatCompletionFn: mockChat({ ok: true, content: '{"ticker":"MSFT","side":"buy","sizeUsd":300}' }),
      fetchReferenceFn,
      fetchMarketStatusFn: tradingStatus(),
    });
    expect(fetchReferenceFn).toHaveBeenCalledWith({ ticker: "MSFT", cheapPoolAddress: POOL_025, sizeUsd: 300 });
  });

  it("an unavailable reference blocks at the guardrail", async () => {
    const result = await handleInstruction("buy 200 dollars of msft", {
      ...base(),
      chatCompletionFn: mockChat({ ok: true, content: '{"ticker":"MSFT","side":"buy","sizeUsd":200}' }),
      fetchReferenceFn: vi.fn<FetchReferenceFn>(async () => ({ status: "unavailable", reason: "getaddrinfo ENOTFOUND web3.binance.com" })),
      fetchMarketStatusFn: tradingStatus(),
    });
    expect(result.ok && result.outcome).toBe("blocked");
    expect(result.ok && result.verdict.blockedBy).toBe("referencePrice");
  });

  it("moment B with no reference fails two checks, so the runbook needs Binance reachable", async () => {
    const result = await handleInstruction("buy 1000 dollars of msft", {
      ...base(),
      chatCompletionFn: mockChat({ ok: true, content: '{"ticker":"MSFT","side":"buy","sizeUsd":1000}' }),
      fetchReferenceFn: vi.fn<FetchReferenceFn>(async () => ({ status: "unavailable", reason: "HTTP 503" })),
      fetchMarketStatusFn: tradingStatus(),
    });
    const failed = result.ok ? result.verdict.checks.filter((c) => !c.ok).map((c) => c.name) : [];
    expect(failed).toEqual(["referencePrice", "perTradeCap"]);
  });
});

describe("handleInstruction — no order during price-history warm-up", () => {
  it("returns a typed warming_up rejection before building any order, and writes nothing", async () => {
    const chatCompletionFn = mockChat({ ok: true, content: '{"ticker":"MSFT","side":"buy","sizeUsd":1000}' });
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();
    const history = historyWith(3);

    const result = await handleInstruction("buy 1000 dollars of msft", {
      chatCompletionFn,
      fetchPoolQuotesFn: vi.fn().mockResolvedValue(msftPoolQuotes()),
      estimateGasFn: pinnedGas,
      fetchReferenceFn: agreeingReference(),
      fetchMarketStatusFn: tradingStatus(),
      priceHistory: history,
      walletClient,
      ledger,
      spendTracker: new DailySpendTracker(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({ kind: "warming_up", ticker: "MSFT", readings: 3, required: 10 }));
    }
    expect(ledger.readAll()).toHaveLength(0);
    expect(walletClient.checkAllowance).not.toHaveBeenCalled();
    // Manual instructions read the history but never add to it.
    expect(history.recent(POOL_025)).toHaveLength(3);
  });
});
