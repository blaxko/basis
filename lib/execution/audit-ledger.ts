import { appendFileSync } from "node:fs";
import type { GuardrailVerdict } from "../guardrails/check";

export type PipelineMode = "simulation" | "dry-run" | "live";

export type PipelineOutcome =
  | "blocked"
  | "error"
  | "simulated"
  | "spread_closed"
  | "approval_failed"
  | "dry_run_failed"
  | "dry_run_only"
  | "executed"
  | "send_failed";

// One row per pipeline run (PRD rule 8: every decision — approved,
// blocked, or failed — gets an entry, not only successful executions).
// Carries Phase 2's verdict unmodified so a ledger view can render the
// full guardrail breakdown without re-deriving it.
export interface AuditLedgerEntry {
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: PipelineOutcome;
  verdict: GuardrailVerdict;
  // Immediately-pre-send re-read of both pools, checked against
  // spreadFreshnessCheck — the MEV/front-running mitigation for bypassing
  // Binance's aggregator. Present only for modes that reach past the
  // guardrail gate.
  freshness?: { freshSpread: number; ok: boolean; reason?: string };
  // ERC-20 allowance check (checkAllowance(), called before the swap
  // simulation/send in the pipeline) — present only for modes that reach
  // the wallet.
  approval?: { needed: boolean; txId?: string; error?: string };
  dryRun?: { outputUsd: number; ok: boolean; reason?: string };
  send?: { txId: string } | { error: string };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ledger_${Date.now()}_${counter}`;
}

// Append-only writer. No update/delete is exposed on purpose — the only
// way to change what the ledger says happened is to append a new entry.
// Storage is in-memory by default; an optional filePath additionally
// appends each entry as a JSON line, since the point of this phase is
// the shape and the append-only guarantee, not the storage backend.
export class AuditLedger {
  private entries: AuditLedgerEntry[] = [];

  constructor(private readonly filePath?: string) {}

  append(entry: Omit<AuditLedgerEntry, "id" | "timestamp">): AuditLedgerEntry {
    const full: AuditLedgerEntry = { id: nextId(), timestamp: Date.now(), ...entry };
    this.entries.push(full);
    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(full) + "\n", "utf8");
    }
    return full;
  }

  readAll(): readonly AuditLedgerEntry[] {
    return this.entries;
  }
}

// Shared singleton so lib/orchestration/agent-loop.ts,
// lib/orchestration/handle-instruction.ts, and GET /api/ledger all
// observe the same entries within one server process. Tests always
// construct their own AuditLedger instance instead, for isolation.
export const defaultLedger = new AuditLedger();
