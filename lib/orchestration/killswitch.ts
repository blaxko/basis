import type { PipelineMode } from "../execution/audit-ledger";
import { isPublicReadOnly, ReadOnlyModeError } from "../config/deployment";

export type { PipelineMode } from "../execution/audit-ledger";

// Default on every server start is "simulation" — never dry-run or live
// by default, full stop (PRD rule 9). setKillswitchMode is the only
// thing that can move it, and only ever via an explicit call — apart from
// the public demo's automatic return to simulation, below.
//
// Kept on globalThis, not in a module-level variable: Next.js bundles
// instrumentation.ts (which runs the scheduler) separately from the API
// routes, so a module-level variable gave each bundle its own copy and
// the UI's switch never reached the scheduler. One process, one mode.
const STATE_KEY = Symbol.for("basis.killswitch.state");

// On a PUBLIC_READ_ONLY deployment the mode is shared by every visitor, so
// a mode other than simulation lasts this long after the latest change
// and then returns to simulation by itself.
export const PUBLIC_MODE_RESET_MS = 5 * 60_000;

interface KillswitchState {
  mode: PipelineMode;
  // Epoch ms at which a public deployment returns to simulation, or null.
  revertAt: number | null;
}

function state(): KillswitchState {
  const g = globalThis as unknown as Record<symbol, KillswitchState | undefined>;
  const s = (g[STATE_KEY] ??= { mode: "simulation", revertAt: null });
  s.revertAt ??= null;
  return s;
}

// Applied on every read (the scheduler reads every tick, /api/status every
// few seconds), so the return happens without a separate timer.
function applyPublicReset(s: KillswitchState, now: number): void {
  if (s.revertAt !== null && now >= s.revertAt) {
    s.mode = "simulation";
    s.revertAt = null;
  }
}

export function getKillswitchMode(now: number = Date.now()): PipelineMode {
  const s = state();
  applyPublicReset(s, now);
  return s.mode;
}

// When a public deployment's mode will return to simulation, or null.
export function getKillswitchRevertAt(now: number = Date.now()): number | null {
  const s = state();
  applyPublicReset(s, now);
  return s.revertAt;
}

// In PUBLIC_READ_ONLY mode "live" is refused here, server-side — not only
// in the UI — so no request can put a public deployment into live mode.
// Any other change there starts (or restarts) the 5-minute return timer;
// choosing simulation clears it.
export function setKillswitchMode(next: PipelineMode, now: number = Date.now()): void {
  const readOnly = isPublicReadOnly();
  if (next === "live" && readOnly) throw new ReadOnlyModeError('setting the killswitch to "live"');
  const s = state();
  s.mode = next;
  s.revertAt = readOnly && next !== "simulation" ? now + PUBLIC_MODE_RESET_MS : null;
}
