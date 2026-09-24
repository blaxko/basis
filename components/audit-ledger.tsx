"use client";

import { usePoll } from "./use-poll";
import type { AuditLedgerEntry, DetectionSnapshot, LedgerResponse, NoOpportunityLedgerEntry, PipelineLedgerEntry } from "./api-types";

const POLL_MS = 10_000;

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace("Z", " UTC");
}

function signedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(3)}%`;
}

function pools(d: DetectionSnapshot): string {
  return `${d.cheapPool.feeUnits / 10_000}% pool $${d.cheapPool.priceUsd.toFixed(2)} vs ${
    d.expensivePool.feeUnits / 10_000
  }% pool $${d.expensivePool.priceUsd.toFixed(2)}`;
}

// Two kinds of row. A detection row is the detector deciding there is no
// opportunity — no order was built and no guardrail ran. A pipeline row
// is an order going through the guardrail gate and however far past it
// the mode allowed. Nothing here fabricates a step that wasn't recorded.
export function AuditLedger() {
  const poll = usePoll<LedgerResponse>("/api/ledger", POLL_MS);
  const entries = poll.data?.entries ?? [];

  return (
    <section className="panel panel--terminal">
      <h2 className="panel-title mono">Audit Ledger</h2>

      {poll.loading && !poll.data && <p className="state-message mono">loading ledger…</p>}
      {poll.error && <p className="state-message state-message--error mono">ledger unavailable: {poll.error}</p>}

      <div className="terminal-feed">
        {entries.length === 0 && !poll.loading && (
          <p className="terminal-empty mono">no ledger entries yet.</p>
        )}
        {entries.map((entry) => (
          <LedgerRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function LedgerRow({ entry }: { entry: AuditLedgerEntry }) {
  return entry.kind === "detection" ? <DetectionRow entry={entry} /> : <PipelineRow entry={entry} />;
}

function DetectionRow({ entry }: { entry: NoOpportunityLedgerEntry }) {
  const d = entry.detection;
  return (
    <div className="terminal-line">
      <div className="terminal-line-meta">
        {fmtTime(entry.timestamp)} · mode={entry.mode} · outcome={entry.outcome}
      </div>
      <div>
        {d.ticker} — detection: no opportunity, no order built. {pools(d)} · gross gap {signedPct(d.grossGap)} · net edge{" "}
        {signedPct(d.netEdge)} (needs &gt; {signedPct(Math.max(0, d.threshold))})
      </div>
    </div>
  );
}

function PipelineRow({ entry }: { entry: PipelineLedgerEntry }) {
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
          detected: {pools(entry.detection)} · net edge {signedPct(entry.detection.netEdge)}
        </div>
      )}
      {entry.outcome === "no_edge" && (
        <div>no edge: net {signedPct(entry.verdict.input.adjustedSpread)} is not positive — nothing sent</div>
      )}
      {entry.freshness && (
        <div>
          pre-send re-read: net {signedPct(entry.freshness.freshSpread)} — {entry.freshness.ok ? "still clears" : "closed"}
          {entry.freshness.reason ? ` (${entry.freshness.reason})` : ""}
        </div>
      )}
      {entry.approval?.needed && (
        <div>
          approval: {entry.approval.txId ? `sent ${entry.approval.txId}` : entry.approval.error ? `failed: ${entry.approval.error}` : "needed, not sent in this mode"}
        </div>
      )}
      {entry.dryRun && (
        <div>
          dry-run: {entry.dryRun.ok ? "ok" : "failed"}, output=${entry.dryRun.outputUsd}
          {entry.dryRun.reason ? ` (${entry.dryRun.reason})` : ""}
        </div>
      )}
      {entry.send && "txId" in entry.send && <div>tx: {entry.send.txId}</div>}
      {entry.send && "error" in entry.send && <div>send failed: {entry.send.error}</div>}
    </div>
  );
}
