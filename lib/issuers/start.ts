import { defaultRecorder, TICK_MS } from "./cross-issuer";
import { defaultLedger } from "../execution/audit-ledger";
import { getTradingWalletAddress } from "../execution/agentic-wallet";
import { logServerError } from "../errors/public-error";

// Starts the read-only cross-issuer recorder on server start
// (instrumentation.ts), every 30 s, offset 15 s from the scheduler so the
// two don't call Binance in the same second. Wires it to the scheduler's
// latest MSFTB quote and gas estimate (reused from the ledger, so no extra
// calls). The wallet address is public: RFQ quotes (bStocks, Ondo) need it.
export const RECORDER_INTERVAL_MS = TICK_MS;
const STATE_KEY = Symbol.for("basis.crossIssuer.timer");

export function startCrossIssuerRecorder(): void {
  const g = globalThis as unknown as Record<symbol, ReturnType<typeof setInterval> | undefined>;
  if (g[STATE_KEY]) return;

  let userWalletAddress: string | undefined;
  try {
    userWalletAddress = getTradingWalletAddress();
  } catch {
    userWalletAddress = undefined;
  }

  const latest = () => {
    const points = defaultLedger.recentEvaluations("MSFT");
    return points[points.length - 1];
  };
  const recorder = defaultRecorder({
    userWalletAddress,
    latestMsftbBuy: () => {
      const p = latest();
      return p && p.detection.reference.status === "ok" ? { priceUsdPerToken: p.detection.reference.priceUsd, at: p.timestamp } : null;
    },
    latestGasUsd: () => latest()?.detection.gas.costUsd ?? null,
  });

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap
    running = true;
    try {
      await recorder.tick();
    } catch (err) {
      logServerError("cross-issuer tick failed", err);
    } finally {
      running = false;
    }
  };
  setTimeout(() => {
    void tick();
    g[STATE_KEY] = setInterval(tick, RECORDER_INTERVAL_MS);
  }, 15_000);
}
