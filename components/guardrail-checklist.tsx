"use client";

import { usePoll } from "./use-poll";
import type { GuardrailCheckResult, GuardrailVerdict, LedgerResponse, OpportunitiesResponse, WarmUpStatus } from "./api-types";
import { notSentReason, verdictBadge } from "./verdict-wording";

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
  const latestPipeline = ledger.data?.entries?.find((e) => e.kind === "pipeline");
  const latestLedgerVerdict = latestPipeline?.kind === "pipeline" ? latestPipeline.verdict : null;
  const verdict: GuardrailVerdict | null = previewVerdict ?? latestLedgerVerdict;
  // What happened to it: the ledger's outcome, or null for a preview.
  const outcome = previewVerdict ? null : latestPipeline?.kind === "pipeline" ? latestPipeline.outcome : null;
  const badge = verdict ? verdictBadge(verdict, outcome) : null;

  const warming = Object.entries(opportunities.data?.warmUp ?? {}).filter(([, status]) => !status.complete);

  const loading = opportunities.loading && ledger.loading && !verdict;
  const error = opportunities.error ?? ledger.error;

  return (
    <section className="panel" id="gate">
      <div className="panel-head">
        <h2 className="panel-title">Guardrail Gate</h2>
        {verdict && <span className="pill pill--plain mono">{outcome === null ? "live preview" : `last order · ${new Date(verdict.timestamp).toISOString().slice(11, 19)} UTC`}</span>}
      </div>

      {loading && <p className="state-message">Loading guardrail state…</p>}
      {error && !verdict && <p className="state-message state-message--error">Guardrail data unavailable: {error}</p>}

      {warming.length > 0 && <WarmUpBanner warming={warming} />}

      {!verdict && !loading && !error && warming.length === 0 && (
        <p className="state-message">No guardrail evaluations yet — nothing has cleared the opportunity threshold.</p>
      )}

      {verdict && badge && (
        <>
          <div className="verdict">
            <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
            <span className="verdict-reason">
              {verdict.input.ticker} ${verdict.input.sizeUsd} ·{" "}
              {badge.tone === "not-sent" ? `${notSentReason(outcome, verdict.input.adjustedSpread)} · ${verdict.reason}` : verdict.reason}
            </span>
          </div>

          <ul className="check-list">
            {verdict.checks.map((c) => (
              <li className="check-item" key={c.name}>
                <span className={"check-mark mono " + markClass(c)}>{markLabel(c)}</span>
                <span className="check-body">
                  <span className="check-name mono">{c.name}</span>
                  {c.limit && <span className="check-limit">Limit: {c.limit}</span>}
                  {(!c.ok || c.pending) && c.reason && <span className="check-reason">{c.reason}</span>}
                </span>
                {c.measured && <span className="check-measured mono">Measured: {c.measured}</span>}
              </li>
            ))}
            {verdict.checks.length === 0 && (
              <li className="check-item state-message">no checks recorded (internal error before checks ran)</li>
            )}
          </ul>
        </>
      )}

      <details className="toggles">
        <summary>What each check does</summary>
        <dl className="check-help">
          {Object.entries(CHECK_DESCRIPTIONS).map(([name, desc]) => (
            <div key={name}>
              <dt className="mono">{name}</dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
      </details>
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

// What each check does, in words. Its threshold and what it measured come
// from the server (check()'s `limit` and `measured`), never from here.
const CHECK_DESCRIPTIONS: Record<string, string> = {
  sanityAndLiquidity: "Both pools' prices look sane against their own recent readings, and the thinner pool holds enough money.",
  marketStatus:
    "Binance's RWA status for the underlying stock. Passes on TRADING and on MARKET_CLOSED (Basis may trade outside stock-market hours); blocks paused, limited, maintenance or an unknown status.",
  referencePrice: "The buy pool's spot price is close to Binance's aggregator quote for the same purchase: a cross-check against a bad pool read.",
  perTradeCap: "The size of this order.",
  dailyCap: "Everything sent today (UTC) plus this order.",
  dryRunFloor: "The simulated swap must return enough of the order's value; it runs on the QuoterV2 output before any send.",
};

function markLabel(c: GuardrailCheckResult): string {
  if (c.warmingUp) return "[WARMING UP]";
  if (c.pending) return "[PENDING]";
  return c.ok ? "[PASS]" : "[FAIL]";
}

function markClass(c: GuardrailCheckResult): string {
  if (c.warmingUp || c.pending) return "check-mark--pending";
  return c.ok ? "check-mark--ok" : "check-mark--fail";
}
