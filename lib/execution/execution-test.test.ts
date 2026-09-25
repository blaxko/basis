import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, parseUnits, type Address } from "viem";
import {
  runExecutionTest,
  binanceHealthProblem,
  EXECUTION_TEST_HARD_CAP_USD_PER_LEG,
  SELL_ONLY_REQUEST,
  type ExecutionTestDeps,
} from "./execution-test";
import type { BinanceCallRecord } from "../data/binance-client";
import { SentButUnconfirmedError } from "./agentic-wallet";

// Three recent successful Binance calls, each under 5 s: the health gate
// passes. Shapes as the app's call log records them.
function call(overrides: Partial<BinanceCallRecord> = {}): BinanceCallRecord {
  return { at: "2026-09-25T12:36:35.984Z", method: "GET", path: "/api/v1/dex/aggregator/quote", query: "", httpStatus: 200, latencyMs: 1466, apiCode: 0, ok: true, ...overrides };
}
const HEALTHY = [call(), call({ path: "/api/v1/dex/market/rwa/underlying-market", latencyMs: 1448 }), call({ latencyMs: 960 })];
import { AuditLedger } from "./audit-ledger";
import { V3_SWAP_ROUTER_ABI, PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS } from "../data/pancakeswap-v3";
import type { PipelineMode } from "./audit-ledger";
import { DailySpendTracker } from "../orchestration/spend-tracker";
import { dailyCapCheck } from "../guardrails/check";
import { DEFAULT_GUARDRAIL_CONFIG } from "../guardrails/config";

const USDT = "0x55d398326f99059fF775485246999027B3197955" as Address;
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" as Address;
const WALLET = "0x1234567890123456789012345678901234567890" as Address;
const E18 = 10n ** 18n;

// SYNTHETIC wallet and pool, not live readings: a pool at $500 whose swaps
// fill at exactly the quoted amount, and a wallet holding $10 USDT and
// 0.01 BNB. Every send is recorded and moves the balances.
function fakeChain(opts: { usdt?: bigint; bnb?: bigint; price?: number; allowance?: bigint; failSend?: (label: string) => string | null } = {}) {
  const price = opts.price ?? 500;
  const balances: Record<string, bigint> = { [USDT.toLowerCase()]: opts.usdt ?? 10n * E18, [MSFTB.toLowerCase()]: 0n };
  const allowances: Record<string, bigint> = { [USDT.toLowerCase()]: opts.allowance ?? 0n, [MSFTB.toLowerCase()]: opts.allowance ?? 0n };
  const sent: string[] = [];

  const out = (tokenIn: Address, amountIn: bigint): bigint =>
    tokenIn.toLowerCase() === USDT.toLowerCase() ? (amountIn * 1_000n) / BigInt(price * 1_000) : (amountIn * BigInt(price * 1_000)) / 1_000n;

  const send = vi.fn(async (tx: { to: string; data: string }) => {
    if (tx.to !== PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS) {
      const label = `approve:${tx.to === USDT ? "USDT" : "MSFTB"}`;
      sent.push(label);
      const failure = opts.failSend?.(label);
      if (failure) throw new Error(failure);
      allowances[tx.to.toLowerCase()] = 10n ** 30n;
      return { txId: `0x${label}`, raw: {} };
    }
    const { args } = decodeFunctionData({ abi: V3_SWAP_ROUTER_ABI, data: tx.data as `0x${string}` });
    const p = args[0];
    const label = `swap:${p.tokenIn === USDT ? "buy" : "sell"}`;
    sent.push(label);
    const failure = opts.failSend?.(label);
    if (failure) throw new Error(failure);
    balances[p.tokenIn.toLowerCase()]! -= p.amountIn;
    balances[p.tokenOut.toLowerCase()]! += out(p.tokenIn, p.amountIn);
    return { txId: `0x${label}`, raw: { orderId: "o", simulation: { result: "succeeded", status: "SUCCESS", balanceChanges: [], allowanceChanges: [] } } };
  });

  const deps = (
    mode: PipelineMode = "live",
    ledger = new AuditLedger(),
    spendTracker = new DailySpendTracker()
  ): ExecutionTestDeps & { ledger: AuditLedger; spendTracker: DailySpendTracker } => ({
    getKillswitchMode: () => mode,
    recentBinanceCalls: () => HEALTHY,
    spendTracker,
    ledger,
    getWalletAddress: () => WALLET,
    readPool: async (pool) => ({ poolAddress: pool.address, feeUnits: pool.feeUnits, priceUsd: price, liquidityUsdEstimate: 1e6, token0: USDT, token1: MSFTB }),
    getDecimals: async () => 18,
    getBalance: async (token) => balances[token.toLowerCase()] ?? 0n,
    getNativeBalance: async () => opts.bnb ?? parseUnits("0.01", 18),
    checkAllowance: async ({ tokenAddress, amountRequired }) => {
      const current = allowances[tokenAddress.toLowerCase()] ?? 0n;
      return current >= amountRequired
        ? { sufficient: true, currentAllowance: current }
        : { sufficient: false, currentAllowance: current, approveTransaction: { to: tokenAddress, data: "0x095ea7b3" } };
    },
    quote: async ({ tokenIn, amountIn }) => ({ amountOut: out(tokenIn, amountIn), gasEstimate: 150_000n }),
    send,
    slippageTolerance: 0.0005,
  });

  return { deps, send, sent, balances };
}

describe("runExecutionTest — refusals send nothing and are ledgered as execution_test", () => {
  it.each([
    ["over the $5 hard cap", { sizeUsd: 5.01, confirm: true }, "live", "exceeds the hard cap of $5 per leg"],
    ["a non-positive size", { sizeUsd: 0, confirm: true }, "live", "positive number"],
    ["a NaN size", { sizeUsd: Number.NaN, confirm: true }, "live", "positive number"],
    ["no confirmation flag", { sizeUsd: 1, confirm: false }, "live", "confirm: true"],
    ["killswitch in dry-run", { sizeUsd: 1, confirm: true }, "dry-run", 'the killswitch is "dry-run"'],
    ["killswitch in simulation", { sizeUsd: 1, confirm: true }, "simulation", 'the killswitch is "simulation"'],
  ] as const)("refuses %s", async (_label, request, mode, reason) => {
    const chain = fakeChain();
    const d = chain.deps(mode);
    const entry = await runExecutionTest(request, d);

    expect(entry.kind).toBe("execution_test");
    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain(reason);
    expect(entry.legs).toEqual([]);
    expect(chain.send).not.toHaveBeenCalled();
    expect(d.ledger.readAll()).toEqual([entry]);
  });

  it("the hard cap is $5 and exactly $5 is allowed", async () => {
    expect(EXECUTION_TEST_HARD_CAP_USD_PER_LEG).toBe(5);
    const chain = fakeChain();
    const entry = await runExecutionTest({ sizeUsd: 5, confirm: true }, chain.deps());
    expect(entry.outcome).toBe("completed");
  });

  it("refuses without enough BNB for gas, before any send", async () => {
    const chain = fakeChain({ bnb: parseUnits("0.0001", 18) });
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, chain.deps());
    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain("BNB is required for gas");
    expect(chain.send).not.toHaveBeenCalled();
  });

  it("refuses when the wallet isn't configured", async () => {
    const chain = fakeChain();
    const d = { ...chain.deps(), getWalletAddress: () => { throw new Error("NotImplemented: BSC_RPC_URL / TRADING_WALLET_PRIVATE_KEY are not set."); } };
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, d);
    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain("NotImplemented");
  });
});

describe("runExecutionTest — the round trip", () => {
  it("approves, buys, approves, sells back exactly what the buy delivered, and writes one entry", async () => {
    const chain = fakeChain();
    const d = chain.deps();
    const entry = await runExecutionTest({ sizeUsd: 2, confirm: true }, d);

    expect(chain.sent).toEqual(["approve:USDT", "swap:buy", "approve:MSFTB", "swap:sell"]);
    expect(entry.kind).toBe("execution_test");
    expect(entry.outcome).toBe("completed");
    expect(entry.pool).toEqual({ address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500 });

    const [buy, sell] = entry.legs;
    expect(buy).toMatchObject({ side: "buy", tokenIn: USDT, tokenOut: MSFTB, amountIn: (2n * E18).toString(), approval: { needed: true, txId: "0xapprove:USDT" }, txId: "0xswap:buy" });
    expect(buy!.received).toBe((2n * E18 / 500n).toString()); // 0.004 MSFTB at $500
    expect(buy!.transactionSimulation).toMatchObject({ result: "succeeded" });
    expect(sell).toMatchObject({ side: "sell", tokenIn: MSFTB, tokenOut: USDT, amountIn: buy!.received, txId: "0xswap:sell" });
    expect(sell!.received).toBe((2n * E18).toString());
    expect(d.ledger.readAll()).toEqual([entry]);
  });

  it("sends each swap with amountOutMinimum = QuoterV2 output less the tolerance, to the wallet", async () => {
    const chain = fakeChain();
    await runExecutionTest({ sizeUsd: 2, confirm: true }, chain.deps());
    const swaps = chain.send.mock.calls.map(([tx]) => tx).filter((tx) => tx.to === PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS);
    const buyArgs = decodeFunctionData({ abi: V3_SWAP_ROUTER_ABI, data: swaps[0]!.data as `0x${string}` }).args[0];
    expect(buyArgs.fee).toBe(2500);
    expect(buyArgs.recipient).toBe(WALLET);
    const quoted = (2n * E18) / 500n;
    expect(buyArgs.amountOutMinimum).toBe(quoted - (quoted * 500n) / 1_000_000n);
  });

  it("skips approvals that already exist", async () => {
    const chain = fakeChain({ allowance: 10n ** 30n });
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, chain.deps());
    expect(chain.sent).toEqual(["swap:buy", "swap:sell"]);
    expect(entry.legs[0]!.approval).toEqual({ needed: false });
  });

  it("caps the sell leg at $5 at the current price; the excess stays and is reported", async () => {
    // The wallet already holds MSFTB from elsewhere; the buy's measured
    // delta is what gets sold, re-capped at the pool price.
    const chain = fakeChain({ allowance: 10n ** 30n });
    const d = chain.deps();
    let reads = 0;
    // Price doubles between the buy and the sell: the $5 bought is now worth $10.
    d.readPool = async (pool) => ({ poolAddress: pool.address, feeUnits: pool.feeUnits, priceUsd: reads++ === 0 ? 500 : 1000, liquidityUsdEstimate: 1e6, token0: USDT, token1: MSFTB });
    const entry = await runExecutionTest({ sizeUsd: 5, confirm: true }, d);

    expect(entry.outcome).toBe("completed");
    expect(entry.legs[1]!.amountIn).toBe((5n * E18 / 1000n).toString()); // $5 at $1000
    expect(entry.reason).toContain("stay in the wallet");
  });
});

describe("runExecutionTest — counts toward the shared daily spend cap", () => {
  it("records both mined legs on the same tracker the guardrail's dailyCapCheck reads", async () => {
    const chain = fakeChain();
    const d = chain.deps();
    const entry = await runExecutionTest({ sizeUsd: 5, confirm: true }, d);

    expect(entry.outcome).toBe("completed");
    // Buy $5; sell 0.01 MSFTB at the $500 pool price = $5.
    expect(entry.spendRecordedUsd).toBeCloseTo(10, 10);
    expect(d.spendTracker.getSpentToday()).toBeCloseTo(10, 10);

    // A $1,995 arbitrage order fits an empty day's $2,000 cap, but with
    // the test's $10 already on the same tracker it's now blocked.
    const verdict = dailyCapCheck({ sizeUsd: 1995 } as never, { spentTodaySoFarUsd: d.spendTracker.getSpentToday() }, DEFAULT_GUARDRAIL_CONFIG);
    expect(verdict.ok).toBe(false);
  });

  it("refuses up front when both legs wouldn't fit under the cap, sending nothing", async () => {
    const chain = fakeChain();
    const tracker = new DailySpendTracker();
    tracker.recordSpend(DEFAULT_GUARDRAIL_CONFIG.perDayCapUsd - 9); // $9 of headroom; the round trip needs $10
    const entry = await runExecutionTest({ sizeUsd: 5, confirm: true }, chain.deps("live", new AuditLedger(), tracker));

    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain("exceeds daily cap $2000");
    expect(entry.spendRecordedUsd).toBe(0);
    expect(chain.send).not.toHaveBeenCalled();
  });

  it("records only the leg that was mined when the sell fails", async () => {
    const chain = fakeChain({ failSend: (l) => (l === "swap:sell" ? "transaction 0xabc was mined but reverted" : null) });
    const d = chain.deps();
    const entry = await runExecutionTest({ sizeUsd: 2, confirm: true }, d);

    expect(entry.outcome).toBe("sell_failed");
    expect(entry.spendRecordedUsd).toBe(2);
    expect(d.spendTracker.getSpentToday()).toBe(2);
  });

  it("records nothing when refused or when the buy never went through", async () => {
    const chain = fakeChain({ failSend: (l) => (l === "swap:buy" ? "Binance broadcast failed: HTTP 502" : null) });
    const d = chain.deps();
    await runExecutionTest({ sizeUsd: 2, confirm: true }, d);
    await runExecutionTest({ sizeUsd: 2, confirm: false }, d);
    expect(d.spendTracker.getSpentToday()).toBe(0);
  });
});

describe("runExecutionTest — failures stop where they happen", () => {
  it("buy_failed when the buy swap fails (e.g. Binance predicts a revert): no sell attempted", async () => {
    const chain = fakeChain({ failSend: (l) => (l === "swap:buy" ? "not sent: Binance simulation did not predict success (FAILED: execution reverted: STF)" : null) });
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, chain.deps());

    expect(entry.outcome).toBe("buy_failed");
    expect(entry.legs).toHaveLength(1);
    expect(entry.legs[0]!.error).toContain("execution reverted: STF");
    expect(entry.legs[0]!.approval).toEqual({ needed: true, txId: "0xapprove:USDT" });
    expect(chain.sent).toEqual(["approve:USDT", "swap:buy"]);
  });

  it("buy_failed when the approval fails: the swap is never sent", async () => {
    const chain = fakeChain({ failSend: (l) => (l === "approve:USDT" ? "Binance broadcast failed: HTTP 502: bad gateway" : null) });
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, chain.deps());
    expect(entry.outcome).toBe("buy_failed");
    expect(chain.sent).toEqual(["approve:USDT"]);
  });

  it("buy_failed without sending anything when the USDT balance is short", async () => {
    const chain = fakeChain({ usdt: E18 / 2n });
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, chain.deps());
    expect(entry.outcome).toBe("buy_failed");
    expect(entry.legs[0]!.error).toContain("insufficient");
    expect(chain.send).not.toHaveBeenCalled();
  });

  it("sell_failed leaves the bought tokens in the wallet and says so via the outcome", async () => {
    const chain = fakeChain({ failSend: (l) => (l === "swap:sell" ? "transaction 0xabc was mined but reverted" : null) });
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, chain.deps());
    expect(entry.outcome).toBe("sell_failed");
    expect(entry.legs[1]!.error).toContain("reverted");
    expect(chain.balances[MSFTB.toLowerCase()]).toBe(E18 / 500n);
  });
});

describe("partial failure: buy mined, sell not — recorded with the state it leaves", () => {
  it("records sell_failed with the buy tx, the sell error, the MSFTB still held, and the recovery request", async () => {
    // Binance unreachable when the sell is attempted: send() refuses before signing.
    const unreachable = "not sent: Binance simulation did not predict success (The operation was aborted due to timeout)";
    const chain = fakeChain({ allowance: 10n ** 30n, failSend: (l) => (l === "swap:sell" ? unreachable : null) });
    const d = chain.deps();
    const entry = await runExecutionTest({ sizeUsd: 2, confirm: true }, d);

    expect(entry).toMatchObject({ kind: "execution_test", action: "round_trip", outcome: "sell_failed", spendRecordedUsd: 2 });
    expect(entry.legs[0]).toMatchObject({ side: "buy", txId: "0xswap:buy", received: ((2n * E18) / 500n).toString() });
    expect(entry.legs[1]).toMatchObject({ side: "sell", error: unreachable });
    expect(entry.legs[1]!.txId).toBeUndefined();
    // The state left behind, read on-chain after the failure.
    expect(entry.targetBalanceAfter).toBe(((2n * E18) / 500n).toString());
    expect(chain.balances[USDT.toLowerCase()]).toBe(8n * E18);
    expect(entry.reason).toContain("the wallet still holds 0.004 MSFTB");
    expect(entry.reason).toContain(SELL_ONLY_REQUEST);
    expect(d.ledger.readAll()).toEqual([entry]);
  });

  it("a sell broadcast whose receipt is unconfirmed keeps its hash as pendingTxId and counts the spend", async () => {
    const chain = fakeChain({ allowance: 10n ** 30n });
    const d = chain.deps();
    const realSend = d.send!;
    d.send = vi.fn(async (tx) => {
      if (tx.to === PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS) {
        const { args } = decodeFunctionData({ abi: V3_SWAP_ROUTER_ABI, data: tx.data as `0x${string}` });
        if (args[0].tokenIn === MSFTB) throw new SentButUnconfirmedError("0x" + "ef".repeat(32), "Timed out while waiting for transaction");
      }
      return realSend(tx);
    });
    const entry = await runExecutionTest({ sizeUsd: 2, confirm: true }, d);

    expect(entry.outcome).toBe("sell_failed");
    expect(entry.legs[1]!.pendingTxId).toBe("0x" + "ef".repeat(32));
    expect(entry.legs[1]!.error).toContain("may still be mined");
    // Buy $2 + the possibly-mined sell ($2), counted conservatively.
    expect(entry.spendRecordedUsd).toBeCloseTo(4, 10);
  });
});

describe("sell_only recovery — same route, same cap, same live + confirm requirements", () => {
  it("after a failed sell, sells exactly the MSFTB the wallet holds and records it", async () => {
    let sellFails = true;
    const chain = fakeChain({ allowance: 10n ** 30n, failSend: (l) => (l === "swap:sell" && sellFails ? "not sent: Binance unreachable" : null) });
    const d = chain.deps();
    await runExecutionTest({ sizeUsd: 2, confirm: true }, d); // leaves 0.004 MSFTB
    sellFails = false;

    const entry = await runExecutionTest({ action: "sell_only", confirm: true }, d);

    expect(entry).toMatchObject({ kind: "execution_test", action: "sell_only", outcome: "completed", targetBalanceAfter: "0" });
    expect(entry.legs).toHaveLength(1);
    expect(entry.legs[0]).toMatchObject({ side: "sell", tokenIn: MSFTB, tokenOut: USDT, amountIn: ((2n * E18) / 500n).toString(), txId: "0xswap:sell" });
    expect(entry.sizeUsd).toBe(2);
    expect(chain.balances[MSFTB.toLowerCase()]).toBe(0n);
    expect(chain.balances[USDT.toLowerCase()]).toBe(10n * E18);
    // The buy and the recovery sell, on the shared tracker.
    expect(d.spendTracker.getSpentToday()).toBeCloseTo(4, 10);
    expect(d.ledger.readAll().map((e) => (e.kind === "execution_test" ? `${e.action}:${e.outcome}` : e.kind))).toEqual([
      "round_trip:sell_failed",
      "sell_only:completed",
    ]);
  });

  it("caps the sale at $5 of MSFTB and says the rest remains", async () => {
    const chain = fakeChain({ allowance: 10n ** 30n });
    chain.balances[MSFTB.toLowerCase()] = E18 / 50n; // 0.02 MSFTB = $10 at $500
    const entry = await runExecutionTest({ action: "sell_only", confirm: true }, chain.deps());

    expect(entry.outcome).toBe("completed");
    expect(entry.legs[0]!.amountIn).toBe(((5n * E18) / 500n).toString());
    expect(entry.sizeUsd).toBe(5);
    expect(entry.reason).toContain("run sell_only again for the rest");
    expect(chain.balances[MSFTB.toLowerCase()]).toBe(E18 / 100n);
  });

  it.each([
    ["no confirmation", { action: "sell_only" as const, confirm: false }, "live" as const, "confirm: true"],
    ["killswitch in simulation", { action: "sell_only" as const, confirm: true }, "simulation" as const, 'the killswitch is "simulation"'],
    ["killswitch in dry-run", { action: "sell_only" as const, confirm: true }, "dry-run" as const, 'the killswitch is "dry-run"'],
  ])("refuses with %s, sending nothing", async (_label, request, mode, reason) => {
    const chain = fakeChain();
    chain.balances[MSFTB.toLowerCase()] = E18 / 500n;
    const entry = await runExecutionTest(request, chain.deps(mode));
    expect(entry).toMatchObject({ action: "sell_only", outcome: "refused" });
    expect(entry.reason).toContain(reason);
    expect(chain.send).not.toHaveBeenCalled();
  });

  it("refuses when the wallet holds no MSFTB", async () => {
    const chain = fakeChain();
    const entry = await runExecutionTest({ action: "sell_only", confirm: true }, chain.deps());
    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain("holds no MSFTB");
    expect(chain.send).not.toHaveBeenCalled();
  });

  it("counts toward the daily cap and refuses if the sale would not fit", async () => {
    const chain = fakeChain();
    chain.balances[MSFTB.toLowerCase()] = E18 / 100n; // $5
    const tracker = new DailySpendTracker();
    tracker.recordSpend(DEFAULT_GUARDRAIL_CONFIG.perDayCapUsd - 4);
    const entry = await runExecutionTest({ action: "sell_only", confirm: true }, chain.deps("live", new AuditLedger(), tracker));
    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain("exceeds daily cap");
    expect(chain.send).not.toHaveBeenCalled();
  });
});

describe("Binance health gate — last 3 calls ok, each within 5 s", () => {
  it("passes on three recent successes under 5 s, including exactly 5000 ms", () => {
    expect(binanceHealthProblem(HEALTHY)).toBeNull();
    expect(binanceHealthProblem([call(), call(), call({ latencyMs: 5000 })])).toBeNull();
    // Only the last three count.
    expect(binanceHealthProblem([call({ ok: false, httpStatus: null, latencyMs: 14000 }), ...HEALTHY])).toBeNull();
  });

  it.each([
    ["fewer than 3 calls recorded", [call(), call()], "only 2 Binance call(s) recorded"],
    ["a timeout", [call(), call(), call({ ok: false, httpStatus: null, apiCode: null, latencyMs: 14001 })], "failed (no response, 14001 ms)"],
    ["a compliance refusal", [call({ ok: false, httpStatus: 200, apiCode: 40304, latencyMs: 2318 }), call(), call()], "failed (HTTP 200 code 40304, 2318 ms)"],
    ["a slow success", [call(), call({ latencyMs: 9919 }), call()], "ok but 9919 ms"],
  ])("fails on %s", (_label, calls, detail) => {
    expect(binanceHealthProblem(calls)).toContain(detail);
  });

  it.each([
    ["round_trip", { sizeUsd: 2, confirm: true }],
    ["sell_only", { action: "sell_only" as const, confirm: true }],
  ])("a failed gate refuses %s, is ledgered like any other outcome, and sends nothing", async (action, request) => {
    const chain = fakeChain();
    chain.balances[MSFTB.toLowerCase()] = E18 / 500n;
    const d = { ...chain.deps(), recentBinanceCalls: () => [call(), call(), call({ ok: false, httpStatus: null, latencyMs: 10011 })] };
    const entry = await runExecutionTest(request, d);

    expect(entry).toMatchObject({ kind: "execution_test", action, outcome: "refused", legs: [], spendRecordedUsd: 0 });
    expect(entry.reason).toContain("Binance health gate");
    expect(d.ledger.readAll()).toEqual([entry]);
    expect(chain.send).not.toHaveBeenCalled();
  });

  it("uses the app's own call log by default", async () => {
    const { defaultBinanceCallLog } = await import("../data/binance-client");
    const chain = fakeChain();
    const deps: ExecutionTestDeps = { ...chain.deps(), recentBinanceCalls: undefined };
    for (let i = 0; i < 3; i++) defaultBinanceCallLog.record(call({ ok: false, httpStatus: null, latencyMs: 14000 }));
    const entry = await runExecutionTest({ sizeUsd: 1, confirm: true }, deps);
    expect(entry.reason).toContain("Binance health gate");
    expect(chain.send).not.toHaveBeenCalled();
  });
});
