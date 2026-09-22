import { check, dryRunFloorCheck, type ProposedOrder } from "../guardrails/check";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import { dryRun, send, type WalletOrderRequest, type DryRunResult, type SendResult } from "./agentic-wallet";
import { AuditLedger, type AuditLedgerEntry, type PipelineMode } from "./audit-ledger";

export type { PipelineMode } from "./audit-ledger";

// Injectable so callers (and tests) can swap in mocks without needing
// live credentials — defaults to the real Agentic Wallet client.
export interface WalletClient {
  dryRun(order: WalletOrderRequest): Promise<DryRunResult>;
  send(order: WalletOrderRequest): Promise<SendResult>;
}

const defaultWalletClient: WalletClient = { dryRun, send };

export interface PipelineDeps {
  spentTodaySoFarUsd: number;
  config?: GuardrailConfig;
  walletClient?: WalletClient;
  ledger?: AuditLedger;
}

// Thin orchestrator: decides nothing itself. Calls the Phase 2 gate,
// and only acts on an approved verdict — never re-derives or overrides
// its decision. `mode` gates how far an approved order is allowed to
// go, standing in for the killswitch until Phase 5 wires a UI to it:
//
//   "simulation" — stops after the guardrail verdict; no wallet call at all.
//   "dry-run"    — calls the real dryRun(), re-checks the same floor the
//                  gate already validated (output can drift by call time),
//                  but never calls send(). This is the default: mode must
//                  be passed explicitly to reach "live" (PRD rule 9).
//   "live"       — same dry-run step first (PRD rule 3: no path skips it),
//                  and only on a passing dry-run does send() fire.
//
// Every outcome — blocked, error, simulated, a failed dry-run, a
// dry-run-only stop, an execution, or a failed send — writes exactly one
// audit ledger entry (PRD rule 8).
export async function runPipeline(
  order: ProposedOrder,
  deps: PipelineDeps,
  mode: PipelineMode = "dry-run"
): Promise<AuditLedgerEntry> {
  const config = deps.config ?? DEFAULT_GUARDRAIL_CONFIG;
  const walletClient = deps.walletClient ?? defaultWalletClient;
  const ledger = deps.ledger ?? new AuditLedger();

  const verdict = check(order, { spentTodaySoFarUsd: deps.spentTodaySoFarUsd, config });

  if (!verdict.approved) {
    return ledger.append({
      mode,
      outcome: verdict.status === "error" ? "error" : "blocked",
      verdict,
    });
  }

  if (mode === "simulation") {
    return ledger.append({ mode, outcome: "simulated", verdict });
  }

  const walletOrder: WalletOrderRequest = { symbol: order.ticker, side: order.side, sizeUsd: order.sizeUsd };
  const dryRunResult = await walletClient.dryRun(walletOrder);

  // Belt-and-suspenders: reuse the gate's own floor check rather than
  // reimplementing the threshold math, against the freshly-observed
  // dry-run output instead of the modeled simulatedOutputUsd the gate saw.
  const floorCheck = dryRunFloorCheck({ ...order, simulatedOutputUsd: dryRunResult.outputUsd }, config);

  if (!floorCheck.ok) {
    return ledger.append({
      mode,
      outcome: "dry_run_failed",
      verdict,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: false, reason: floorCheck.reason },
    });
  }

  if (mode === "dry-run") {
    return ledger.append({
      mode,
      outcome: "dry_run_only",
      verdict,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: true },
    });
  }

  try {
    const sendResult = await walletClient.send(walletOrder);
    return ledger.append({
      mode,
      outcome: "executed",
      verdict,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: true },
      send: { txId: sendResult.txId },
    });
  } catch (err) {
    return ledger.append({
      mode,
      outcome: "send_failed",
      verdict,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: true },
      send: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
