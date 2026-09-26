import { appendFileSync } from "node:fs";
import type { GuardrailVerdict } from "../guardrails/check";
import type { ReferenceQuote } from "../data/binance-reference";
import type { TxSimulation } from "../data/binance-transaction";
import type { MarketStatus } from "../data/binance-rwa";

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
  // The on-chain slippage tolerance is not below the net edge (detected,
  // or fresh at the pre-send re-read), so the swap's minimum-output floor
  // couldn't protect it.
  | "tolerance_exceeds_edge"
  // Live mode refuses: only one leg (the buy) is built, and a single leg
  // alone doesn't capture the spread. Nothing is approved or sent.
  | "two_leg_execution_not_implemented"
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
  // The round-trip gas figure used in netEdge, and whether it came from
  // a live estimate or the flat fallback.
  gas: { costUsd: number; source: "live" | "fallback" };
  // Binance aggregator quote for buying the target at the order size,
  // fetched on the same tick — or why it couldn't be.
  reference: ReferenceQuote;
  // The underlying market's status (RWA Data API), same tick — or why it
  // couldn't be fetched. Includes marketStatus and reasonMsg as returned.
  marketStatus: MarketStatus;
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
  // orderId: Binance's broadcast-transaction id for the same transaction.
  approval?: { needed: boolean; txId?: string; orderId?: string; error?: string };
  dryRun?: { outputUsd: number; ok: boolean; reason?: string };
  // Binance Transaction API simulation of our own exactInputSingle
  // calldata from the trading wallet, run after the QuoterV2 floor
  // passes. Present only for runs that reached it.
  transactionSimulation?: TxSimulation;
  send?: { txId: string; orderId?: string } | { error: string };
}

// A detection decision, not a guardrail decision: no order was built and
// check() never ran. Deliberately a different `kind` with no `verdict`
// field, so it can't be mistaken for a guardrail block.
//   "no_opportunity" — the net edge did not clear the threshold.
//   "warming_up"     — it did, but a pool has fewer price readings than
//                      minPriceHistoryReadings, so no order is proposed.
//
// Consecutive "no_opportunity" detections for the same ticker and mode are
// compacted at write time into ONE entry: `detection` and `timestamp` are
// the latest reading's, and `run` summarises every reading folded in
// (count, first time, ranges, how many used fallback gas or had no Binance
// reference). Individual readings stay available for the chart through
// AuditLedger.recentEvaluations() (the last 120 per ticker).
export interface DetectionRun {
  count: number;
  firstTimestamp: number;
  netEdgeMin: number;
  netEdgeMax: number;
  grossGapMin: number;
  grossGapMax: number;
  fallbackGas: number;
  noReference: number;
}

export interface DetectionLedgerEntry {
  kind: "detection";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "no_opportunity" | "warming_up";
  detection: DetectionSnapshot;
  warmUp?: { readings: number; required: number };
  // Present once a second consecutive no_opportunity reading is folded in.
  run?: DetectionRun;
}

// One leg of the manual execution test (lib/execution/execution-test.ts).
// Amounts are integer strings in each token's smallest unit.
export interface ExecutionTestLeg {
  side: "buy" | "sell";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  // QuoterV2's simulated output and the on-chain minimum sent with the swap.
  quotedAmountOut?: string;
  amountOutMinimum?: string;
  // pendingTxId: broadcast, receipt unconfirmed — may still be mined.
  approval?: { needed: boolean; txId?: string; pendingTxId?: string; orderId?: string };
  // Binance Transaction API simulation of the swap, as send() saw it.
  transactionSimulation?: TxSimulation;
  txId?: string;
  // Binance's broadcast-transaction orderId for the swap (with txId or
  // pendingTxId).
  orderId?: string;
  // The swap was broadcast but its receipt is unconfirmed: it may still be
  // mined. Check it on-chain before running anything else.
  pendingTxId?: string;
  // Balance delta of tokenOut measured on-chain after the swap.
  received?: string;
  error?: string;
}

// A manual execution test — NOT an arbitrage. A deliberately separate
// `kind` with no verdict or detection, so it can't be mistaken for, or
// counted as, a pipeline decision.
//   "refused"     — a precondition failed; nothing was sent.
//   "buy_failed"  — the buy leg (or its approval) failed.
//   "sell_failed" — the buy completed; the sell leg failed, so the
//                   wallet still holds the bought tokens.
//   "completed"   — both legs mined.
export interface ExecutionTestLedgerEntry {
  kind: "execution_test";
  id: string;
  timestamp: number;
  // "round_trip" (buy then sell) or "sell_only" (recovery: sell what the
  // wallet holds).
  action: "round_trip" | "sell_only";
  mode: PipelineMode;
  outcome: "refused" | "buy_failed" | "sell_failed" | "completed";
  sizeUsd: number;
  pool: { address: string; feeUnits: number };
  reason?: string;
  legs: ExecutionTestLeg[];
  // USD recorded against the shared daily spend tracker by this run.
  spendRecordedUsd: number;
  // The wallet's MSFTB balance (smallest unit) read after the run, when
  // any leg was attempted.
  targetBalanceAfter?: string;
}

// The scheduler skipped a tick because the previous one was still
// running: no evaluation happened for that interval. Recorded so the gap
// is visible, never silently dropped.
export interface SchedulerLedgerEntry {
  kind: "scheduler";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "tick_skipped";
  // When the still-running tick started, and how long it had run.
  runningTickStartedAt: string;
  runningForMs: number;
}

export type AuditLedgerEntry = PipelineLedgerEntry | DetectionLedgerEntry | ExecutionTestLedgerEntry | SchedulerLedgerEntry;
export type LedgerOutcome = AuditLedgerEntry["outcome"];

// In-memory ledger with bounded memory. What is kept:
//   - every pipeline, execution-test, scheduler and warming_up entry, in
//     full detail;
//   - consecutive no_opportunity detections (same ticker, same mode,
//     nothing else recorded in between) as one compacted run entry
//     (DetectionLedgerEntry.run) — the only entry ever updated after it's
//     written, and only by folding in the next reading of its run;
//   - the last CHART_POINTS readings per ticker, individually, for the
//     chart; and exact running totals (stats(), evaluationCount()).
// A hard cap (MAX_STORED_ENTRIES) drops the oldest stored entries if it's
// ever reached — only possible under sustained abuse of the rate-limited
// instruction route — and counts what it dropped.
// An optional filePath additionally appends every decision, uncompacted,
// as a JSON line.
export const MAX_STORED_ENTRIES = 5_000;
export const CHART_POINTS = 120;

export interface LedgerStats {
  decisions: number; // every decision ever recorded, compacted or not
  storedEntries: number;
  droppedEntries: number; // stored entries removed by the hard cap
  droppedDecisions: number; // decisions inside those entries
}

export interface EvaluationPoint {
  timestamp: number;
  detection: DetectionSnapshot;
}

export class AuditLedger {
  private entries: AuditLedgerEntry[] = [];
  private counter = 0;
  private decisions = 0;
  private droppedEntries = 0;
  private droppedDecisions = 0;
  // The open no_opportunity run per ticker, if nothing else has been
  // written since it was last extended.
  private openRuns = new Map<string, DetectionLedgerEntry>();
  private evaluations = new Map<string, { count: number; recent: EvaluationPoint[] }>();

  constructor(private readonly filePath?: string) {}

  append(entry: Omit<PipelineLedgerEntry, "id" | "timestamp" | "kind">): PipelineLedgerEntry {
    return this.write({ kind: "pipeline", id: this.nextId(), timestamp: Date.now(), ...entry });
  }

  appendNoOpportunity(entry: { mode: PipelineMode; detection: DetectionSnapshot }): DetectionLedgerEntry {
    const timestamp = Date.now();
    const open = this.openRuns.get(entry.detection.ticker);
    if (open && open.mode === entry.mode) {
      this.foldIntoRun(open, entry.detection, timestamp);
      this.decisions += 1;
      this.recordEvaluation(entry.detection, timestamp);
      this.appendToFile({ ...open, detection: entry.detection, timestamp });
      return open;
    }
    const written = this.write({ kind: "detection", id: this.nextId(), timestamp, outcome: "no_opportunity", ...entry });
    this.openRuns.set(entry.detection.ticker, written);
    return written;
  }

  appendWarmingUp(entry: {
    mode: PipelineMode;
    detection: DetectionSnapshot;
    warmUp: { readings: number; required: number };
  }): DetectionLedgerEntry {
    return this.write({ kind: "detection", id: this.nextId(), timestamp: Date.now(), outcome: "warming_up", ...entry });
  }

  appendExecutionTest(entry: Omit<ExecutionTestLedgerEntry, "id" | "timestamp" | "kind">): ExecutionTestLedgerEntry {
    return this.write({ kind: "execution_test", id: this.nextId(), timestamp: Date.now(), ...entry });
  }

  appendTickSkipped(entry: Omit<SchedulerLedgerEntry, "id" | "timestamp" | "kind" | "outcome">): SchedulerLedgerEntry {
    return this.write({ kind: "scheduler", id: this.nextId(), timestamp: Date.now(), outcome: "tick_skipped", ...entry });
  }

  private nextId(): string {
    this.counter += 1;
    return `ledger_${Date.now()}_${this.counter}`;
  }

  // Stored entries, oldest first (runs compacted).
  readAll(): readonly AuditLedgerEntry[] {
    return this.entries;
  }

  stats(): LedgerStats {
    return {
      decisions: this.decisions,
      storedEntries: this.entries.length,
      droppedEntries: this.droppedEntries,
      droppedDecisions: this.droppedDecisions,
    };
  }

  // Every evaluation of `ticker` this session (detections, and automatic
  // pipeline runs that carry a detection), compacted or not.
  evaluationCount(ticker: string): number {
    return this.evaluations.get(ticker)?.count ?? 0;
  }

  // The last CHART_POINTS evaluations of `ticker`, oldest first.
  recentEvaluations(ticker: string): readonly EvaluationPoint[] {
    return this.evaluations.get(ticker)?.recent ?? [];
  }

  private foldIntoRun(entry: DetectionLedgerEntry, next: DetectionSnapshot, timestamp: number): void {
    const prev = entry.detection;
    const run: DetectionRun = entry.run ?? {
      count: 1,
      firstTimestamp: entry.timestamp,
      netEdgeMin: prev.netEdge,
      netEdgeMax: prev.netEdge,
      grossGapMin: prev.grossGap,
      grossGapMax: prev.grossGap,
      fallbackGas: prev.gas.source === "fallback" ? 1 : 0,
      noReference: prev.reference.status === "ok" ? 0 : 1,
    };
    run.count += 1;
    run.netEdgeMin = Math.min(run.netEdgeMin, next.netEdge);
    run.netEdgeMax = Math.max(run.netEdgeMax, next.netEdge);
    run.grossGapMin = Math.min(run.grossGapMin, next.grossGap);
    run.grossGapMax = Math.max(run.grossGapMax, next.grossGap);
    if (next.gas.source === "fallback") run.fallbackGas += 1;
    if (next.reference.status !== "ok") run.noReference += 1;
    entry.run = run;
    entry.detection = next;
    entry.timestamp = timestamp;
  }

  private recordEvaluation(detection: DetectionSnapshot, timestamp: number): void {
    const e = this.evaluations.get(detection.ticker) ?? { count: 0, recent: [] };
    e.count += 1;
    e.recent.push({ timestamp, detection });
    if (e.recent.length > CHART_POINTS) e.recent.splice(0, e.recent.length - CHART_POINTS);
    this.evaluations.set(detection.ticker, e);
  }

  private write<T extends AuditLedgerEntry>(full: T): T {
    // Anything written closes every open run: a run only folds readings
    // that follow each other with nothing in between.
    this.openRuns.clear();
    this.entries.push(full);
    this.decisions += 1;
    const detection = full.kind === "detection" || full.kind === "pipeline" ? full.detection : undefined;
    if (detection) this.recordEvaluation(detection, full.timestamp);
    if (this.entries.length > MAX_STORED_ENTRIES) {
      const removed = this.entries.splice(0, this.entries.length - MAX_STORED_ENTRIES);
      this.droppedEntries += removed.length;
      this.droppedDecisions += removed.reduce((n, e) => n + (e.kind === "detection" ? e.run?.count ?? 1 : 1), 0);
    }
    this.appendToFile(full);
    return full;
  }

  private appendToFile(entry: AuditLedgerEntry): void {
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
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
