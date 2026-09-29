"use client";

import { useState } from "react";
import { usePoll } from "./use-poll";
import type { MarketStatus, PipelineMode, StatusResponse } from "./api-types";
import { readOnlyNote, revertLabel } from "./read-only-note";
import { healthChip, type ChipState } from "./health-chip";
import { walletChipLabel } from "./format-balance";
import { showWalletChips } from "./public-mode";
import { GITHUB_URL } from "./landing-content";

const MODES: PipelineMode[] = ["simulation", "dry-run", "live"];

// The dashboard's top bar (home, How it works, GitHub) and its status
// strip: the read-only line, health chips and the mode switch.
// publicReadOnly comes from the server (app/dashboard/page.tsx), so the note and
// the locked Live button are in the first paint; the mode shown is always
// the server's (/api/status), never what was clicked.
export function Header({ publicReadOnly }: { publicReadOnly: boolean }) {
  const status = usePoll<StatusResponse>("/api/status", 5000);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function setMode(mode: PipelineMode) {
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch("/api/killswitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) setPostError(typeof json?.error === "string" ? json.error : `the server returned an error (HTTP ${res.status})`);
    } catch {
      setPostError("couldn't reach the server");
    } finally {
      setPosting(false);
      // Always re-pull server state after the attempt, success or not —
      // the displayed mode below never comes from what was clicked, only
      // from the latest /api/status response.
      status.refetch();
    }
  }

  const currentMode = status.data?.killswitch ?? null;
  const readOnly = status.data?.publicReadOnly ?? publicReadOnly;
  const note = readOnlyNote(readOnly);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="wordmark" href="/">
            Basis
          </a>
          <nav className="topnav" aria-label="Site">
            <a href="/#how">How it works</a>
            <a href={GITHUB_URL}>GitHub</a>
          </nav>
        </div>
      </header>

      <div className="strip" id="top">
        <div className="strip-inner">
          {note && (
            <span className="strip-note">
              {note.text} ·{" "}
              <a href={note.linkUrl}>{note.linkLabel}</a>
            </span>
          )}
          {/* Fixed-height row: placeholders hold its place until /api/status
              answers, so nothing below moves (no layout shift). */}
          <div className="status-row" aria-live="polite">
            {!status.data && <span className="status-chip status-chip--placeholder">Loading system status…</span>}
            {status.data && (
              <>
                <HealthChip chip={healthChip("BSC RPC", status.data.bscRpc, Date.now())} />
                <StatusChip
                  label={binanceChipLabel(status.data.binanceWeb3Api)}
                  ok={status.data.binanceWeb3Api.configured && (status.data.binanceWeb3Api.calls[0]?.ok ?? false)}
                />
                <HealthChip chip={healthChip("Groq", status.data.groq, Date.now())} />
                {Object.entries(status.data.marketStatus).map(([ticker, market]) => (
                  <StatusChip key={ticker} label={marketChipLabel(ticker, market)} ok={marketChipOk(market)} />
                ))}
                {showWalletChips(readOnly) && (
                  <>
                    <StatusChip
                      label={
                        status.data.tradingWallet.address
                          ? `Trading wallet ${status.data.tradingWallet.address.slice(0, 6)}…${status.data.tradingWallet.address.slice(-4)}`
                          : status.data.tradingWallet.error
                            ? "Trading wallet key invalid"
                            : "Trading wallet key"
                      }
                      ok={status.data.tradingWallet.configured}
                    />
                    <StatusChip
                      label={status.data.walletBalances.status === "ok" ? walletChipLabel(status.data.walletBalances) : "Wallet balances unavailable"}
                      ok={status.data.walletBalances.status === "ok"}
                    />
                  </>
                )}
              </>
            )}
          </div>
          <div className="killswitch" role="group" aria-label="Mode">
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={
                  "killswitch-button" +
                  (currentMode === mode ? " killswitch-button--active" : "") +
                  (mode === "live" ? " killswitch-button--live" : "")
                }
                aria-pressed={currentMode === mode}
                // Convenience only: the server rejects "live" in read-only mode.
                disabled={posting || status.loading || (mode === "live" && readOnly)}
                title={mode === "live" && note ? note.liveButtonTitle : undefined}
                onClick={() => setMode(mode)}
              >
                {mode === "live" && readOnly && <LockIcon />}
                {mode}
              </button>
            ))}
          </div>
        </div>
        {status.data?.killswitchRevertsAt && (
          <p className="strip-line">
            <strong>{revertLabel(status.data.killswitchRevertsAt)}</strong> Changes on this public demo are shared by every visitor, so they don't last.
          </p>
        )}
        {status.error && <p className="strip-line state-message--error">Status unavailable: {status.error}</p>}
        {postError && <p className="strip-line killswitch-error">Mode change failed: {postError}</p>}
      </div>
    </>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="10" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Green only when configured AND the most recent call succeeded; the
// label carries that call's latency, or why it failed.
function binanceChipLabel(api: StatusResponse["binanceWeb3Api"]): string {
  const last = api.calls[0];
  if (!api.configured) return "Binance Web3 API · not configured";
  if (!last) return "Binance Web3 API · no calls yet";
  if (last.ok) return `Binance Web3 API · ${last.latencyMs}ms`;
  return `Binance Web3 API · ${last.httpStatus === null ? "unreachable" : `HTTP ${last.httpStatus}${last.apiCode !== null ? ` code ${last.apiCode}` : ""}`}`;
}

function fmtUtc(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

// The underlying market's status as Binance's RWA Data API last reported
// it, with the next open/close time when Binance supplies one (it can be
// null even while trading).
function marketChipLabel(ticker: string, m: MarketStatus): string {
  if (m.status !== "ok") return `${ticker} underlying market · status unavailable`;
  const code = m.reasonCode ?? (m.openState ? "open" : "not tradable");
  const parts = [`${ticker} underlying market · ${code}`];
  if (m.marketStatus) parts.push(m.marketStatus);
  if (m.reasonMsg) parts.push(m.reasonMsg);
  const nextOpen = fmtUtc(m.nextOpenTime);
  const nextClose = fmtUtc(m.nextCloseTime);
  if (nextOpen) parts.push(`opens ${nextOpen}`);
  if (nextClose) parts.push(`closes ${nextClose}`);
  return parts.join(" · ");
}

// Green when the marketStatus guardrail would pass (TRADING, or
// MARKET_CLOSED — trading through closed hours is intended).
function marketChipOk(m: MarketStatus): boolean {
  if (m.status !== "ok") return false;
  if (m.reasonCode === null) return m.openState;
  return m.reasonCode === "TRADING" || m.reasonCode === "MARKET_CLOSED";
}

// Green = the last call worked, red = it failed, grey = no call yet.
function HealthChip({ chip }: { chip: { label: string; state: ChipState } }) {
  return (
    <span className="status-chip">
      <span className={"status-dot" + (chip.state === "ok" ? " status-dot--ok" : chip.state === "unknown" ? " status-dot--unknown" : "")} />
      {chip.label}
    </span>
  );
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="status-chip">
      <span className={"status-dot" + (ok ? " status-dot--ok" : "")} />
      {label}
    </span>
  );
}
