"use client";

import { useState } from "react";
import { usePoll } from "./use-poll";
import type { PipelineMode, StatusResponse } from "./api-types";

const MODES: PipelineMode[] = ["simulation", "dry-run", "live"];

function fmtUsd(value: number | null): string {
  return value === null ? "n/a" : `$${value.toLocaleString()}`;
}

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
                disabled={posting || status.loading}
                onClick={() => setMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {status.loading && !status.data && <p className="state-message">Loading system status…</p>}
      {status.error && <p className="state-message state-message--error">Status unavailable: {status.error}</p>}
      {postError && <p className="killswitch-error">Killswitch update failed: {postError}</p>}

      {status.data && (
        <>
          <div className="status-row">
            <StatusChip label="Groq" ok={status.data.groq.configured} />
            <StatusChip label="BSC RPC" ok={status.data.bscRpc.configured} />
            <StatusChip label="Trading wallet key" ok={status.data.tradingWallet.configured} />
            <StatusChip
              label={binanceChipLabel(status.data.binanceWeb3Api)}
              ok={status.data.binanceWeb3Api.configured && (status.data.binanceWeb3Api.calls[0]?.ok ?? false)}
            />
          </div>

          <div className="wallet-split">
            <div className="wallet-card">
              <div className="wallet-card-label">Trading Capital</div>
              <div className="wallet-card-value">{fmtUsd(status.data.wallet.tradingCapitalUsd)}</div>
            </div>
            <div className="wallet-card">
              <div className="wallet-card-label">Operating Budget</div>
              <div className="wallet-card-value">{fmtUsd(status.data.wallet.operatingBudgetUsd)}</div>
            </div>
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

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="status-chip">
      <span className={"status-dot" + (ok ? " status-dot--ok" : "")} />
      {label}
    </span>
  );
}
