import { runAgentLoop, DEFAULT_AGENT_LOOP_CONFIG } from "./agent-loop";
import { getKillswitchMode } from "./killswitch";
import type { PipelineMode } from "../execution/audit-ledger";

export const DEFAULT_SCHEDULER_INTERVAL_MS = 30_000;

export interface SchedulerOptions {
  intervalMs?: number;
  underlyings?: readonly string[];
  getMode?: () => PipelineMode;
  runAgentLoopFn?: typeof runAgentLoop;
  log?: (message: string) => void;
}

export interface TickResult {
  mode: PipelineMode;
  results: Array<{ ticker: string; ok: boolean; error?: string }>;
}

const defaultLog = (message: string) => console.log(`[basis:scheduler] ${message}`);

// Reads the killswitch once at the start of each tick (never cached
// across ticks) and passes that value through to every underlying in the
// tick, so one tick is internally consistent and a flip between ticks
// takes effect on the very next one. The scheduler only reads the mode;
// it never writes it.
export async function runTick(options: SchedulerOptions = {}): Promise<TickResult> {
  const getMode = options.getMode ?? getKillswitchMode;
  const runAgentLoopFn = options.runAgentLoopFn ?? runAgentLoop;
  const underlyings = options.underlyings ?? DEFAULT_AGENT_LOOP_CONFIG.underlyings;
  const log = options.log ?? defaultLog;

  const mode = getMode();
  log(`tick mode=${mode}`);

  const results: TickResult["results"] = [];
  for (const ticker of underlyings) {
    try {
      const result = await runAgentLoopFn({
        getMode: () => mode,
        agentConfig: { ...DEFAULT_AGENT_LOOP_CONFIG, underlyings: [ticker] },
      });
      results.push({ ticker, ok: true });
      log(`  ${ticker}: ok, ${result.triggered.length} triggered`);
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown error";
      results.push({ ticker, ok: false, error });
      log(`  ${ticker}: failed — ${error}`);
    }
  }

  return { mode, results };
}

interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
}

// Kept on globalThis so a dev-mode hot reload that re-evaluates this
// module can't start a second interval alongside the first.
const STATE_KEY = Symbol.for("basis.scheduler.state");
function state(): SchedulerState {
  const g = globalThis as unknown as Record<symbol, SchedulerState | undefined>;
  return (g[STATE_KEY] ??= { timer: null, inFlight: false });
}

export function isRunning(): boolean {
  return state().timer !== null;
}

// Never called on import — only by instrumentation.ts's register() on
// server start. Idempotent. Skips a tick if the previous one is still
// running rather than overlapping two.
export function start(options: SchedulerOptions = {}): void {
  const s = state();
  if (s.timer !== null) return;

  const intervalMs = options.intervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS;
  const tick = async () => {
    if (s.inFlight) return;
    s.inFlight = true;
    try {
      await runTick(options);
    } finally {
      s.inFlight = false;
    }
  };

  s.timer = setInterval(tick, intervalMs);
  void tick();
}

export function stop(): void {
  const s = state();
  if (s.timer !== null) {
    clearInterval(s.timer);
    s.timer = null;
  }
}
