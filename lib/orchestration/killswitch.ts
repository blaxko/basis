import type { PipelineMode } from "../execution/audit-ledger";

export type { PipelineMode } from "../execution/audit-ledger";

// Minimal in-memory state holder. Default on every server start (i.e.
// every fresh import of this module) is "simulation" — never dry-run or
// live by default, full stop (PRD rule 9). setKillswitchMode is the only
// thing that can move it, and only ever via an explicit call — there is
// no implicit transition anywhere in this module.
let mode: PipelineMode = "simulation";

export function getKillswitchMode(): PipelineMode {
  return mode;
}

export function setKillswitchMode(next: PipelineMode): void {
  mode = next;
}
