import { describe, it, expect, vi, afterEach } from "vitest";
import type { AgentLoopDeps, AgentLoopResult } from "./agent-loop";
import type { PipelineMode } from "../execution/audit-ledger";

const silent = () => {};

function okResult(mode: PipelineMode): AgentLoopResult {
  return { timestamp: 0, mode, spreads: [], triggered: [], noOpportunities: [], warmingUp: [] };
}

afterEach(async () => {
  const { stop } = await import("./scheduler");
  stop();
  vi.useRealTimers();
});

describe("scheduler — never auto-starts", () => {
  // Longer timeout: vi.resetModules() forces a fresh transform of this
  // module's full import graph, which now transitively includes viem
  // (agent-loop.ts -> pipeline.ts -> agentic-wallet.ts) — noticeably
  // slower to cold-transform than the default 5s budget comfortably covers.
  it("importing the module starts no interval", { timeout: 20_000 }, async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const scheduler = await import("./scheduler");

    expect(scheduler.isRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("runTick — per-underlying isolation", () => {
  it("one underlying throwing does not stop the others on the same tick", async () => {
    const { runTick } = await import("./scheduler");
    const calls: string[] = [];
    const runAgentLoopFn = vi.fn(async (deps: AgentLoopDeps = {}) => {
      const ticker = deps.agentConfig!.underlyings[0]!;
      calls.push(ticker);
      if (ticker === "AAPL") throw new Error("quote feed down");
      return okResult(deps.getMode!());
    });

    const result = await runTick({
      underlyings: ["NVDA", "AAPL", "MSFT", "TSLA"],
      getMode: () => "simulation",
      runAgentLoopFn,
      log: silent,
    });

    expect(calls).toEqual(["NVDA", "AAPL", "MSFT", "TSLA"]);
    expect(result.results.filter((r) => r.ok).map((r) => r.ticker)).toEqual(["NVDA", "MSFT", "TSLA"]);
    expect(result.results.find((r) => r.ticker === "AAPL")).toMatchObject({ ok: false, error: "quote feed down" });
  });
});

describe("scheduler — reads killswitch fresh each tick", () => {
  it("a mode change between two ticks is reflected in the second tick", async () => {
    const { runTick } = await import("./scheduler");
    let mode: PipelineMode = "simulation";
    const seen: PipelineMode[] = [];
    const runAgentLoopFn = vi.fn(async (deps: AgentLoopDeps = {}) => {
      seen.push(deps.getMode!());
      return okResult(deps.getMode!());
    });
    const opts = { underlyings: ["MSFT"], getMode: () => mode, runAgentLoopFn, log: silent };

    const first = await runTick(opts);
    mode = "dry-run";
    const second = await runTick(opts);

    expect(first.mode).toBe("simulation");
    expect(second.mode).toBe("dry-run");
    expect(seen).toEqual(["simulation", "dry-run"]);
  });

  it("the same holds across real interval ticks after start()", async () => {
    vi.useFakeTimers();
    const { start } = await import("./scheduler");
    let mode: PipelineMode = "simulation";
    const seen: PipelineMode[] = [];
    const runAgentLoopFn = vi.fn(async (deps: AgentLoopDeps = {}) => {
      seen.push(deps.getMode!());
      return okResult(deps.getMode!());
    });

    start({ intervalMs: 1000, underlyings: ["MSFT"], getMode: () => mode, runAgentLoopFn, log: silent });
    await vi.advanceTimersByTimeAsync(0); // immediate first tick
    mode = "live";
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toEqual(["simulation", "live"]);
  });

  it("start() is idempotent — a second call doesn't add a second interval", async () => {
    vi.useFakeTimers();
    const { start } = await import("./scheduler");
    const runAgentLoopFn = vi.fn(async () => okResult("simulation"));
    const opts = { intervalMs: 1000, underlyings: ["MSFT"], getMode: () => "simulation" as const, runAgentLoopFn, log: silent };

    start(opts);
    start(opts);
    await vi.advanceTimersByTimeAsync(1000);

    expect(vi.getTimerCount()).toBe(1);
    expect(runAgentLoopFn).toHaveBeenCalledTimes(2); // immediate tick + one interval tick
  });
});

describe("scheduler — a tick never overlaps the previous one; skips are recorded", () => {
  it("while a tick is still running, the next interval is skipped, written to the ledger, and counted", async () => {
    vi.useFakeTimers();
    const { start, getSchedulerStats } = await import("./scheduler");
    const { AuditLedger } = await import("../execution/audit-ledger");
    const ledger = new AuditLedger();
    const logs: string[] = [];

    let release!: () => void;
    let running = 0;
    let maxConcurrent = 0;
    const runAgentLoopFn = vi.fn(async (deps: AgentLoopDeps = {}) => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise<void>((r) => (release = r));
      running -= 1;
      return okResult(deps.getMode!());
    });
    const skippedBefore = getSchedulerStats().skippedTicks;

    start({ intervalMs: 1000, underlyings: ["MSFT"], getMode: () => "simulation", runAgentLoopFn, log: (m) => logs.push(m), ledger, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(0); // first tick starts and hangs
    await vi.advanceTimersByTimeAsync(1000); // second interval: must be skipped
    await vi.advanceTimersByTimeAsync(1000); // third: skipped too

    expect(runAgentLoopFn).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
    const skipped = ledger.readAll();
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toMatchObject({ kind: "scheduler", outcome: "tick_skipped", mode: "simulation", runningForMs: 1000 });
    expect(skipped[1]).toMatchObject({ runningForMs: 2000 });
    expect(getSchedulerStats().skippedTicks - skippedBefore).toBe(2);
    expect(getSchedulerStats().tickInFlight).toBe(true);
    expect(logs.filter((l) => l.startsWith("tick skipped")).length).toBe(2);

    // Once the running tick finishes, the next interval runs normally.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerStats().tickInFlight).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runAgentLoopFn).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(ledger.readAll()).toHaveLength(2); // no new skip
  });
});
