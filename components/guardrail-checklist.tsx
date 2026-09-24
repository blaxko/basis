"use client";

import { usePoll } from "./use-poll";
import type { GuardrailCheckResult, GuardrailVerdict, LedgerResponse, OpportunitiesResponse, WarmUpStatus } from "./api-types";

const OPPORTUNITIES_POLL_MS = 10_000;
const LEDGER_POLL_MS = 10_000;

// This component only ever displays what lib/guardrails/check.ts produced
// server-side. Nothing here re-evaluates a cap or a floor. A check is
// shown as PASS only when it actually ran on data and passed; one that
// failed for lack of price history shows as WARMING UP, and one with no
// data yet (the dry-run floor before simulation) shows as PENDING.
export function GuardrailChecklist() {
  const opportunities = usePoll<OpportunitiesResponse>("/api/opportunities", OPPORTUNITIES_POLL_MS);
  const ledger = usePoll<LedgerResponse>("/api/ledger", LEDGER_POLL_MS);

  // Primary source: the freshest live preview verdict. Falls back to the
  // most recent ledger entry that actually went through the gate —
  // detection entries have no verdict, because no order was built.
  const previewVerdict = opportunities.data?.opportunities?.[0]?.verdict ?? null;
  const latestLedgerVerdict = ledger.data?.entries?.find((e) => e.kind === "pipeline")?.verdict ?? null;
  const verdict: GuardrailVerdict | null = previewVerdict ?? latestLedgerVerdict;

  const warming = Object.entries(opportunities.data?.warmUp ?? {}).filter(([, status]) => !status.complete);

  const loading = opportunities.loading && ledger.loading && !verdict;
  const error = opportunities.error ?? ledger.error;

  return (
    <section className="panel">
      <h2 className="panel-title">Guardrail Gate</h2>

      {loading && <p className="state-message">Loading guardrail state…</p>}
      {error && !verdict && <p className="state-message state-message--error">Guardrail data unavailable: {error}</p>}

      {warming.length > 0 && <WarmUpBanner warming={warming} />}

      {!verdict && !loading && !error && warming.length === 0 && (
        <p className="state-message">No guardrail evaluations yet — nothing has cleared the opportunity threshold.</p>
      )}

      {verdict && (
        <>
          <div>
            <span className={"badge " + badgeClass(verdict)}>{badgeLabel(verdict)}</span>
            <span style={{ marginLeft: 10, fontSize: "0.85rem", color: "var(--color-muted)" }}>
              {verdict.input.ticker} ${verdict.input.sizeUsd} · {verdict.reason}
            </span>
          </div>

          <ul className="check-list">
            {verdict.checks.map((c) => (
              <li className="check-item" key={c.name}>
                <span className={"check-mark " + markClass(c)}>{markLabel(c)}</span>
                <span>{c.name}</span>
                {(!c.ok || c.pending) && c.reason && <span className="check-reason">— {c.reason}</span>}
              </li>
            ))}
            {verdict.checks.length === 0 && (
              <li className="check-item state-message">no checks recorded (internal error before checks ran)</li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function WarmUpBanner({ warming }: { warming: [string, WarmUpStatus][] }) {
  return (
    <div>
      <span className="badge badge--warming">WARMING UP</span>
      <span style={{ marginLeft: 10, fontSize: "0.85rem", color: "var(--color-muted)" }}>
        {warming.map(([ticker, s]) => `${ticker}: price history ${s.readings} of ${s.required} readings`).join(" · ")} — the
        price sanity check can't pass yet, so no orders are proposed.
      </span>
    </div>
  );
}

function badgeLabel(verdict: GuardrailVerdict): string {
  if (verdict.approved) return "APPROVED";
  if (verdict.status === "error") return "ERROR";
  return verdict.checks.some((c) => c.warmingUp) ? "WARMING UP" : "BLOCKED";
}

function badgeClass(verdict: GuardrailVerdict): string {
  if (verdict.approved) return "badge--approved";
  if (verdict.status === "error") return "badge--error";
  return verdict.checks.some((c) => c.warmingUp) ? "badge--warming" : "badge--blocked";
}

function markLabel(c: GuardrailCheckResult): string {
  if (c.warmingUp) return "[WARMING UP]";
  if (c.pending) return "[PENDING]";
  return c.ok ? "[PASS]" : "[FAIL]";
}

function markClass(c: GuardrailCheckResult): string {
  if (c.warmingUp || c.pending) return "check-mark--pending";
  return c.ok ? "check-mark--ok" : "check-mark--fail";
}
