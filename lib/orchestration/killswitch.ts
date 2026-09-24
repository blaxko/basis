import type { PipelineMode } from "../execution/audit-ledger";

export type { PipelineMode } from "../execution/audit-ledger";

// Default on every server start is "simulation" — never dry-run or live
// by default, full stop (PRD rule 9). setKillswitchMode is the only
// thing that can move it, and only ever via an explicit call.
//
// Kept on globalThis, not in a module-level variable: Next.js bundles
// instrumentation.ts (which runs the scheduler) separately from the API
// routes, so a module-level variable gave each bundle its own copy and
// the UI's switch never reached the scheduler. One process, one mode.
const STATE_KEY = Symbol.for("basis.killswitch.state");

interface KillswitchState {
  mode: PipelineMode;
}

function state(): KillswitchState {
  const g = globalThis as unknown as Record<symbol, KillswitchState | undefined>;
  return (g[STATE_KEY] ??= { mode: "simulation" });
}

export function getKillswitchMode(): PipelineMode {
  return state().mode;
}

export function setKillswitchMode(next: PipelineMode): void {
  state().mode = next;
}
