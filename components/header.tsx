"use client";

import { useState } from "react";
import { usePoll } from "./use-poll";
import type { MarketStatus, PipelineMode, StatusResponse } from "./api-types";
import { readOnlyNote, revertLabel } from "./read-only-note";

const MODES: PipelineMode[] = ["simulation", "dry-run", "live"];

export function Header() {
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
      if (!res.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : `killswitch update failed (${res.status})`);
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "failed to update killswitch");
    } finally {
      setPosting(false);
      // Always re-pull server state after the attempt, success or not —
      // the displayed mode below never comes from what was clicked, only
      // from the latest /api/status response.
      status.refetch();
    }
  }

  const currentMode = status.data?.killswitch ?? null;
  const note = readOnlyNote(status.data?.publicReadOnly);

  return (
    <header className="header">
      <div className="header-top">
        <div>
          <h1 className="header-title">Basis</h1>
          <p className="header-subtitle">Cross-pool gaps, counted only after every cost.</p>
        </div>

        <div className="killswitch">
          <div className="killswitch-buttons">
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={
                  "killswitch-button" +
                  (currentMode === mode ? " killswitch-button--active" : "") +
                  (mode === "live" ? " killswitch-button--live" : "")
                }
                // Convenience only: the server rejects "live" in read-only mode.
                disabled={posting || status.loading || (mode === "live" && (status.data?.publicReadOnly ?? true))}
                title={mode === "live" && note ? note.liveButtonTitle : undefined}
                onClick={() => setMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
          {status.data?.killswitchRevertsAt && (
            <p className="killswitch-note">
              <strong>{revertLabel(status.data.killswitchRevertsAt)}</strong> Changes on this public demo are shared by every
              visitor, so they don't last.
            </p>
          )}
          {note && (
            <p className="killswitch-note">
              {note.text}{" "}
              <a href={note.linkUrl} target="_blank" rel="noreferrer">
                {note.linkLabel}
              </a>
            </p>
          )}
        </div>
      </div>

      {status.loading && !status.data && <p className="state-message">Loading system status…</p>}
      {status.error && <p className="state-message state-message--error">Status unavailable: {status.error}</p>}
      {postError && <p className="killswitch-error">Killswitch update failed: {postError}</p>}

      {status.data && (
        <>
          <div className="status-row">
            {status.data.publicReadOnly && <StatusChip label="Public read-only: no sending" ok={true} />}
            <StatusChip label="Groq" ok={status.data.groq.configured} />
            <StatusChip label="BSC RPC" ok={status.data.bscRpc.configured} />
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
              label={binanceChipLabel(status.data.binanceWeb3Api)}
              ok={status.data.binanceWeb3Api.configured && (status.data.binanceWeb3Api.calls[0]?.ok ?? false)}
            />
            <StatusChip
              label={
                status.data.walletBalances.status === "ok"
                  ? `Wallet · ${status.data.walletBalances.bnb} BNB · ${status.data.walletBalances.usdt} USDT · ${status.data.walletBalances.msftb} MSFTB`
                  : "Wallet balances unavailable"
              }
              ok={status.data.walletBalances.status === "ok"}
            />
            {Object.entries(status.data.marketStatus).map(([ticker, market]) => (
              <StatusChip key={ticker} label={marketChipLabel(ticker, market)} ok={marketChipOk(market)} />
            ))}
          </div>
        </>
      )}
    </header>
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

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="status-chip">
      <span className={"status-dot" + (ok ? " status-dot--ok" : "")} />
      {label}
    </span>
  );
}
