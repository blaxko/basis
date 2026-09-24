import { appendFileSync } from "node:fs";
import type { GuardrailVerdict } from "../guardrails/check";

export type PipelineMode = "simulation" | "dry-run" | "live";

export type PipelineOutcome =
  | "blocked"
  | "error"
  | "simulated"
  // Guardrails approved the order, but its detected net edge was not
  // positive, so nothing was sent. Only reachable from a manual
  // instruction: the automatic loop never builds an order without a
  // positive edge.
  | "no_edge"
  // A positive detected edge decayed or inverted between detection and
  // the pre-send re-read.
  | "spread_closed"
  | "approval_failed"
  | "dry_run_failed"
  | "dry_run_only"
  | "executed"
  | "send_failed";

export interface PoolReading {
  address: string;
  feeUnits: number;
  priceUsd: number;
}

// What the detector saw for one ticker at one moment.
export interface DetectionSnapshot {
  ticker: string;
  cheapPool: PoolReading;
  expensivePool: PoolReading;
  grossGap: number;
  // After both pools' fees, estimated slippage, and gas.
  netEdge: number;
  threshold: number;
}

// One row per pipeline run (PRD rule 8: every decision — approved,
// blocked, or failed — gets an entry, not only successful executions).
// Carries Phase 2's verdict unmodified so a ledger view can render the
// full guardrail breakdown without re-deriving it.
export interface PipelineLedgerEntry {
  kind: "pipeline";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: PipelineOutcome;
  verdict: GuardrailVerdict;
  // Present when the order came from the automatic detector.
  detection?: DetectionSnapshot;
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

// A detection decision, not a guardrail decision: the net edge did not
// clear the threshold, so no order was ever built and check() never ran.
// Deliberately a different `kind` with no `verdict` field, so it can't
// be mistaken for a guardrail block.
export interface NoOpportunityLedgerEntry {
  kind: "detection";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "no_opportunity";
  detection: DetectionSnapshot;
}

export type AuditLedgerEntry = PipelineLedgerEntry | NoOpportunityLedgerEntry;
export type LedgerOutcome = AuditLedgerEntry["outcome"];

// Append-only writer. No update/delete is exposed on purpose — the only
// way to change what the ledger says happened is to append a new entry.
// Storage is in-memory by default; an optional filePath additionally
// appends each entry as a JSON line, since the point of this phase is
// the shape and the append-only guarantee, not the storage backend.
export class AuditLedger {
  private entries: AuditLedgerEntry[] = [];
  private counter = 0;

  constructor(private readonly filePath?: string) {}

  append(entry: Omit<PipelineLedgerEntry, "id" | "timestamp" | "kind">): PipelineLedgerEntry {
    return this.write({ kind: "pipeline", id: this.nextId(), timestamp: Date.now(), ...entry });
  }

  appendNoOpportunity(entry: { mode: PipelineMode; detection: DetectionSnapshot }): NoOpportunityLedgerEntry {
    return this.write({ kind: "detection", id: this.nextId(), timestamp: Date.now(), outcome: "no_opportunity", ...entry });
  }

  private nextId(): string {
    this.counter += 1;
    return `ledger_${Date.now()}_${this.counter}`;
  }

  readAll(): readonly AuditLedgerEntry[] {
    return this.entries;
  }

  private write<T extends AuditLedgerEntry>(full: T): T {
    this.entries.push(full);
    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(full) + "\n", "utf8");
    }
    return full;
  }
}

// Shared singleton so lib/orchestration/agent-loop.ts,
// lib/orchestration/handle-instruction.ts, and GET /api/ledger all
// observe the same entries within one server process. Kept on
// globalThis because Next.js bundles instrumentation.ts (the scheduler)
// separately from the API routes — a plain module-level instance gave
// each bundle its own ledger, and scheduler entries never reached the
// dashboard. Tests always construct their own AuditLedger instead.
const DEFAULT_LEDGER_KEY = Symbol.for("basis.auditLedger.default");
export const defaultLedger: AuditLedger = ((globalThis as unknown as Record<symbol, AuditLedger | undefined>)[
  DEFAULT_LEDGER_KEY
] ??= new AuditLedger());
