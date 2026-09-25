"use client";

import { usePoll } from "./use-poll";
import type {
  DetectionLedgerEntry,
  DetectionSnapshot,
  ExecutionTestLedgerEntry,
  LedgerResponse,
  PipelineLedgerEntry,
  TxSimulation,
} from "./api-types";
import { groupLedgerRows } from "./ledger-groups";

const POLL_MS = 10_000;

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace("Z", " UTC");
}

function fmtClock(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

function signedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(3)}%`;
}

function pools(d: DetectionSnapshot): string {
  return `${d.cheapPool.feeUnits / 10_000}% pool $${d.cheapPool.priceUsd.toFixed(2)} vs ${
    d.expensivePool.feeUnits / 10_000
  }% pool $${d.expensivePool.priceUsd.toFixed(2)}`;
}

function reference(d: DetectionSnapshot): string {
  return d.reference.status === "ok"
    ? `Binance ref $${d.reference.priceUsd.toFixed(2)} (${d.reference.vendor})`
    : `Binance ref UNAVAILABLE (${d.reference.reason})`;
}

// Underlying market status (RWA Data API) as recorded on the evaluation.
function market(d: DetectionSnapshot): string {
  const m = d.marketStatus;
  if (!m) return "market status not recorded";
  if (m.status !== "ok") return `market status UNAVAILABLE (${m.reason})`;
  const code = m.reasonCode ?? (m.openState ? "open" : "not tradable");
  const extra = [m.marketStatus, m.reasonMsg].filter(Boolean).join(", ");
  return `market ${code}${extra ? ` (${extra})` : ""}`;
}

function gas(d: DetectionSnapshot): string {
  return d.gas.source === "live" ? `gas $${d.gas.costUsd.toFixed(3)} (live)` : `gas $${d.gas.costUsd.toFixed(2)} (FALLBACK — live estimate failed)`;
}

// Two kinds of row. A detection row is the detector deciding not to build
// an order — no guardrail ran. A pipeline row is an order going through
// the guardrail gate and however far past it the mode allowed.
//
// Consecutive detection entries for the same ticker and outcome are shown
// as one summary row so a guardrail block stays visible. Display only:
// every entry is still in the ledger and in the /api/ledger response.
export function AuditLedger() {
  const poll = usePoll<LedgerResponse>("/api/ledger", POLL_MS);
  const entries = poll.data?.entries ?? [];
  const groups = groupLedgerRows(entries);

  return (
    <section className="panel panel--terminal">
      <h2 className="panel-title mono">Audit Ledger</h2>

      {poll.loading && !poll.data && <p className="state-message mono">loading ledger…</p>}
      {poll.error && <p className="state-message state-message--error mono">ledger unavailable: {poll.error}</p>}

      <div className="terminal-feed">
        {entries.length === 0 && !poll.loading && <p className="terminal-empty mono">no ledger entries yet.</p>}
        {groups.map((group) =>
          group.type === "pipeline" ? (
            <PipelineRow key={group.entry.id} entry={group.entry} />
          ) : group.type === "execution_test" ? (
            <ExecutionTestRow key={group.entry.id} entry={group.entry} />
          ) : group.type === "scheduler" ? (
            <div key={group.entry.id} className="terminal-line">
              <div className="terminal-line-meta">
                {fmtTime(group.entry.timestamp)} · mode={group.entry.mode} · kind=scheduler · outcome={group.entry.outcome}
              </div>
              <div>
                tick skipped: the previous tick (started {group.entry.runningTickStartedAt.slice(11, 19)} UTC) was still running after{" "}
                {(group.entry.runningForMs / 1000).toFixed(1)}s — no evaluation this interval
              </div>
            </div>
          ) : group.entries.length === 1 ? (
            <DetectionRow key={group.entries[0]!.id} entry={group.entries[0]!} />
          ) : (
            <DetectionSummaryRow key={group.entries[0]!.id} entries={group.entries} />
          )
        )}
      </div>
    </section>
  );
}

function detectionLabel(entry: DetectionLedgerEntry): string {
  return entry.outcome === "warming_up" ? "warming up, no order proposed" : "no opportunity, no order built";
}

function DetectionRow({ entry }: { entry: DetectionLedgerEntry }) {
  const d = entry.detection;
  return (
    <div className="terminal-line">
      <div className="terminal-line-meta">
        {fmtTime(entry.timestamp)} · mode={entry.mode} · outcome={entry.outcome}
      </div>
      <div>
        {d.ticker} — detection: {detectionLabel(entry)}. {pools(d)} · gross gap {signedPct(d.grossGap)} · net edge{" "}
        {signedPct(d.netEdge)} (needs &gt; {signedPct(Math.max(0, d.threshold))}) · {gas(d)} · {reference(d)} · {market(d)}
        {entry.warmUp && ` · price history ${entry.warmUp.readings} of ${entry.warmUp.required} readings`}
      </div>
    </div>
  );
}

// Newest-first, like the rest of the feed: entries[0] is the latest.
function DetectionSummaryRow({ entries }: { entries: DetectionLedgerEntry[] }) {
  const latest = entries[0]!;
  const oldest = entries[entries.length - 1]!;
  const edges = entries.map((e) => e.detection.netEdge);
  const fallbacks = entries.filter((e) => e.detection.gas.source === "fallback").length;
  const noReference = entries.filter((e) => e.detection.reference.status !== "ok").length;
  return (
    <div className="terminal-line">
      <div className="terminal-line-meta">
        {fmtClock(oldest.timestamp)} → {fmtClock(latest.timestamp)} UTC · {entries.length} entries · outcome={latest.outcome}
      </div>
      <div>
        {latest.detection.ticker} — {entries.length}× detection: {detectionLabel(latest)} · net edge {signedPct(Math.min(...edges))} to{" "}
        {signedPct(Math.max(...edges))} · latest: {pools(latest.detection)}
        {` · latest ${reference(latest.detection)} · ${market(latest.detection)}`}
        {fallbacks > 0 && ` · ${fallbacks} used FALLBACK gas`}
        {noReference > 0 && ` · ${noReference} without a Binance reference`}
      </div>
    </div>
  );
}

const OUTCOME_NOTES: Partial<Record<PipelineLedgerEntry["outcome"], (e: PipelineLedgerEntry) => string>> = {
  no_edge: (e) => `no edge: net ${signedPct(e.verdict.input.adjustedSpread)} is not positive — nothing sent`,
  tolerance_exceeds_edge: (e) =>
    `on-chain slippage tolerance isn't below the net edge (${signedPct(e.freshness?.freshSpread ?? e.verdict.input.adjustedSpread)}) — nothing sent`,
  two_leg_execution_not_implemented: () => "live mode refused: only one leg of the arbitrage is built — nothing approved or sent",
};

function PipelineRow({ entry }: { entry: PipelineLedgerEntry }) {
  const note = OUTCOME_NOTES[entry.outcome]?.(entry);
  return (
    <div className="terminal-line">
      <div className="terminal-line-meta">
        {fmtTime(entry.timestamp)} · mode={entry.mode} · outcome={entry.outcome}
      </div>
      <div>
        {entry.verdict.input.ticker} ${entry.verdict.input.sizeUsd} — guardrail:{" "}
        {entry.verdict.approved ? "APPROVED" : entry.verdict.status === "error" ? "ERROR" : "BLOCKED"} ({entry.verdict.reason})
      </div>
      {entry.detection && (
        <div>
          detected: {pools(entry.detection)} · net edge {signedPct(entry.detection.netEdge)} · {gas(entry.detection)} ·{" "}
          {market(entry.detection)}
        </div>
      )}
      {note && <div>{note}</div>}
      {entry.freshness && (
        <div>
          pre-send re-read: net {signedPct(entry.freshness.freshSpread)} — {entry.freshness.ok ? "still clears" : "closed"}
          {entry.freshness.reason ? ` (${entry.freshness.reason})` : ""}
        </div>
      )}
      {entry.approval?.needed && (
        <div>
          approval:{" "}
          {entry.approval.txId ? `sent ${entry.approval.txId}` : entry.approval.error ? `failed: ${entry.approval.error}` : "needed, not sent in this mode"}
        </div>
      )}
      {entry.dryRun && (
        <div>
          dry-run: {entry.dryRun.ok ? "ok" : "failed"}, output=${entry.dryRun.outputUsd}
          {entry.dryRun.reason ? ` (${entry.dryRun.reason})` : ""}
        </div>
      )}
      {entry.transactionSimulation && <div>{binanceSimulation(entry.transactionSimulation)}</div>}
      {entry.send && "txId" in entry.send && <div>tx: {entry.send.txId}</div>}
      {entry.send && "error" in entry.send && <div>send failed: {entry.send.error}</div>}
    </div>
  );
}

// Labeled as a test on every line so it can't be read as an arbitrage.
function ExecutionTestRow({ entry }: { entry: ExecutionTestLedgerEntry }) {
  return (
    <div className="terminal-line">
      <div className="terminal-line-meta">
        {fmtTime(entry.timestamp)} · mode={entry.mode} · kind=execution_test · outcome={entry.outcome}
      </div>
      <div>
        EXECUTION TEST (not arbitrage) — ${entry.sizeUsd} round trip on the {entry.pool.feeUnits / 10_000}% pool · $
        {entry.spendRecordedUsd.toFixed(2)} counted toward the daily cap
        {entry.reason ? ` · ${entry.reason}` : ""}
      </div>
      {entry.legs.map((leg) => (
        <div key={leg.side}>
          {leg.side}: in {leg.amountIn}
          {leg.approval?.needed && ` · approval ${leg.approval.txId ?? "not sent"}`}
          {leg.amountOutMinimum && ` · min out ${leg.amountOutMinimum}`}
          {leg.txId && ` · tx ${leg.txId}`}
          {leg.received && ` · received ${leg.received}`}
          {leg.error && ` · FAILED: ${leg.error}`}
        </div>
      ))}
    </div>
  );
}

function binanceSimulation(sim: TxSimulation): string {
  if (sim.result === "succeeded") return `Binance simulate: ${sim.status} — predicts the swap succeeds`;
  if (sim.result === "failed") return `Binance simulate: ${sim.status} — ${sim.failReason}`;
  return `Binance simulate: UNAVAILABLE (${sim.reason})`;
}
