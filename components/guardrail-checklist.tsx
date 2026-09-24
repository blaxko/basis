"use client";

import { usePoll } from "./use-poll";
import type { GuardrailVerdict, LedgerResponse, OpportunitiesResponse } from "./api-types";

const OPPORTUNITIES_POLL_MS = 10_000;
const LEDGER_POLL_MS = 10_000;

// This component only ever displays a verdict object it's given — every
// checks[] entry, approved/blocked, and reason string below is exactly
// what lib/guardrails/check.ts produced server-side. Nothing here
// re-evaluates a cap or a floor.
export function GuardrailChecklist() {
  const opportunities = usePoll<OpportunitiesResponse>("/api/opportunities", OPPORTUNITIES_POLL_MS);
  const ledger = usePoll<LedgerResponse>("/api/ledger", LEDGER_POLL_MS);

  // Primary source: the freshest live preview verdict, paired with
  // whatever the Advisory Feed is currently showing. Falls back to the
  // most recent ledger entry that actually went through the gate —
  // detection ("no_opportunity") entries have no verdict, because no
  // order was built.
  const previewVerdict = opportunities.data?.opportunities?.[0]?.verdict ?? null;
  const latestLedgerVerdict = ledger.data?.entries?.find((e) => e.kind === "pipeline")?.verdict ?? null;
  const verdict: GuardrailVerdict | null = previewVerdict ?? latestLedgerVerdict;

  const loading = opportunities.loading && ledger.loading && !verdict;
  const error = opportunities.error ?? ledger.error;

  return (
    <section className="panel">
      <h2 className="panel-title">Guardrail Gate</h2>

      {loading && <p className="state-message">Loading guardrail state…</p>}
      {error && !verdict && <p className="state-message state-message--error">Guardrail data unavailable: {error}</p>}

      {!verdict && !loading && !error && (
        <p className="state-message">No guardrail evaluations yet — nothing has cleared the opportunity threshold.</p>
      )}

      {verdict && (
        <>
          <div>
            <span className={"badge " + (verdict.approved ? "badge--approved" : badgeClass(verdict.status))}>
              {verdict.approved ? "APPROVED" : verdict.status === "error" ? "ERROR" : "BLOCKED"}
            </span>
            <span style={{ marginLeft: 10, fontSize: "0.85rem", color: "var(--color-muted)" }}>
              {verdict.input.ticker} · {verdict.reason}
            </span>
          </div>

          <ul className="check-list">
            {verdict.checks.map((c) => (
              <li className="check-item" key={c.name}>
                <span className={"check-mark " + (c.ok ? "check-mark--ok" : "check-mark--fail")}>
                  {c.ok ? "[PASS]" : "[FAIL]"}
                </span>
                <span>{c.name}</span>
                {!c.ok && c.reason && <span className="check-reason">— {c.reason}</span>}
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

function badgeClass(status: GuardrailVerdict["status"]): string {
  return status === "error" ? "badge--error" : "badge--blocked";
}
