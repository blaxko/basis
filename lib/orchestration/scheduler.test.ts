import { describe, it, expect, vi, afterEach } from "vitest";
import type { AgentLoopDeps, AgentLoopResult } from "./agent-loop";
import type { PipelineMode } from "../execution/audit-ledger";

const silent = () => {};

function okResult(mode: PipelineMode): AgentLoopResult {
  return { timestamp: 0, mode, spreads: [], triggered: [], noOpportunities: [] };
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
