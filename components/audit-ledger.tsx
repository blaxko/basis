"use client";

import { usePoll } from "./use-poll";
import type { AuditLedgerEntry, LedgerResponse } from "./api-types";

const POLL_MS = 10_000;

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace("Z", " UTC");
}

// Each row shows the chain this MVP actually records: guardrail check ->
// dry-run result (if the mode reached one) -> send/TxID (if it reached
// one). There is no separate "data fetch" log entry in this phase's
// AuditLedgerEntry shape — the ledger records decisions, not each quote
// pull — so this doesn't fabricate a fetch step that was never recorded.
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
  return (
    <div className="terminal-line">
      <div className="terminal-line-meta">
        {fmtTime(entry.timestamp)} · mode={entry.mode} · outcome={entry.outcome}
      </div>
      <div>
        {entry.verdict.input.ticker} — guardrail: {entry.verdict.approved ? "APPROVED" : "BLOCKED"} ({entry.verdict.reason})
      </div>
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
