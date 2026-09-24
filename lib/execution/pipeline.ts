import { check, dryRunFloorCheck, type ProposedOrder } from "../guardrails/check";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "../guardrails/config";
import {
  dryRun,
  send,
  approvalCheck,
  getTradingWalletAddress,
  type SwapRequest,
  type UnsignedTransaction,
  type DryRunResult,
  type ApprovalCheckResult,
  type SendResult,
} from "./agentic-wallet";
import { getTokenAddresses } from "../data/token-addresses";
import { AuditLedger, type AuditLedgerEntry, type PipelineMode } from "./audit-ledger";

export type { PipelineMode } from "./audit-ledger";
export type { SwapRequest } from "./agentic-wallet";

// Injectable so callers (and tests) can swap in mocks without needing
// live credentials — defaults to the real Agentic Wallet client.
export interface WalletClient {
  approvalCheck(request: SwapRequest): Promise<ApprovalCheckResult>;
  dryRun(request: SwapRequest): Promise<DryRunResult>;
  // Takes an unsigned transaction (from approvalCheck() or dryRun()'s
  // result), not the original order — send() has no way to construct a
  // transaction from a ticker/side/size alone; only the Transaction
  // API's responses actually know the calldata.
  send(unsignedTransaction: UnsignedTransaction): Promise<SendResult>;
}

const defaultWalletClient: WalletClient = { approvalCheck, dryRun, send };

export interface PipelineDeps {
  spentTodaySoFarUsd: number;
  config?: GuardrailConfig;
  walletClient?: WalletClient;
  ledger?: AuditLedger;
  // Injectable so tests never need a populated token-address registry or
  // real trading-wallet credentials just to exercise the guardrail/mode
  // logic below — same DI pattern as everywhere else in this codebase.
  // Defaults to the real implementation.
  buildSwapRequest?: (order: ProposedOrder) => SwapRequest;
}

// Turns a guardrail-approved ProposedOrder into the real Transaction
// API's request shape. Throws NotImplemented (propagates uncaught, same
// as a missing credential does) rather than fabricating a token address
// or an amount — lib/data/token-addresses.ts's registry is empty until
// real BSC contract addresses are confirmed from each protocol's own
// source, so this currently always throws in "dry-run"/"live" mode.
//
// Also unresolved, deliberately not solved here: `amount` must be in
// the fromToken's base units, not USD — order.sizeUsd can't be used
// directly without decimals/price data this codebase doesn't plumb yet.
// That conversion is follow-up work once the token registry is populated.
function defaultBuildSwapRequest(order: ProposedOrder): SwapRequest {
  const { priceReturn, totalReturn } = getTokenAddresses(order.ticker);
  const userWalletAddress = getTradingWalletAddress();

  return {
    binanceChainId: "56",
    fromTokenAddress: order.side === "buy" ? totalReturn : priceReturn,
    toTokenAddress: order.side === "buy" ? priceReturn : totalReturn,
    amount: String(order.sizeUsd),
    userWalletAddress,
    vendor: "LiquidMesh",
    autoSlippage: true,
  };
}

// Thin orchestrator: decides nothing itself. Calls the Phase 2 gate,
// and only acts on an approved verdict — never re-derives or overrides
// its decision. `mode` gates how far an approved order is allowed to
// go, standing in for the killswitch until Phase 5 wires a UI to it:
//
//   "simulation" — stops after the guardrail verdict; no wallet call at all.
//   "dry-run"    — calls approvalCheck() then the real dryRun(), re-checks
//                  the same floor the gate already validated (output can
//                  drift by call time), but never calls send() — not even
//                  for a needed approval. This is the default: mode must
//                  be passed explicitly to reach "live" (PRD rule 9).
//   "live"       — if approvalCheck() says an approval is needed, sends
//                  that transaction first and stops (outcome
//                  "approval_failed") if it fails. Then the same dry-run
//                  step (PRD rule 3: no path skips it), and only on a
//                  passing dry-run does the swap's send() fire.
//
// Every outcome — blocked, error, simulated, a failed approval, a failed
// dry-run, a dry-run-only stop, an execution, or a failed send — writes
// exactly one audit ledger entry (PRD rule 8).
export async function runPipeline(
  order: ProposedOrder,
  deps: PipelineDeps,
  mode: PipelineMode = "dry-run"
): Promise<AuditLedgerEntry> {
  const config = deps.config ?? DEFAULT_GUARDRAIL_CONFIG;
  const walletClient = deps.walletClient ?? defaultWalletClient;
  const ledger = deps.ledger ?? new AuditLedger();
  const buildSwapRequestFn = deps.buildSwapRequest ?? defaultBuildSwapRequest;

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

  const swapRequest = buildSwapRequestFn(order);

  const approval = await walletClient.approvalCheck(swapRequest);
  let approvalInfo: { needed: boolean; txId?: string } = { needed: approval.needsApproval };

  if (approval.needsApproval && mode === "live") {
    try {
      const approvalSendResult = await walletClient.send(approval.approvalTransaction!);
      // Approval succeeded — fall through to the swap's dry-run/send below,
      // carrying its txId into whichever entry gets appended.
      approvalInfo = { needed: true, txId: approvalSendResult.txId };
    } catch (err) {
      return ledger.append({
        mode,
        outcome: "approval_failed",
        verdict,
        approval: { needed: true, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const dryRunResult = await walletClient.dryRun(swapRequest);

  // Belt-and-suspenders: reuse the gate's own floor check rather than
  // reimplementing the threshold math, against the freshly-observed
  // dry-run output instead of the modeled simulatedOutputUsd the gate saw.
  const floorCheck = dryRunFloorCheck({ ...order, simulatedOutputUsd: dryRunResult.outputUsd }, config);

  if (!floorCheck.ok) {
    return ledger.append({
      mode,
      outcome: "dry_run_failed",
      verdict,
      approval: approvalInfo,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: false, reason: floorCheck.reason },
    });
  }

  if (mode === "dry-run") {
    return ledger.append({
      mode,
      outcome: "dry_run_only",
      verdict,
      approval: approvalInfo,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: true },
    });
  }

  try {
    const sendResult = await walletClient.send(dryRunResult.unsignedTransaction);
    return ledger.append({
      mode,
      outcome: "executed",
      verdict,
      approval: approvalInfo,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: true },
      send: { txId: sendResult.txId },
    });
  } catch (err) {
    return ledger.append({
      mode,
      outcome: "send_failed",
      verdict,
      approval: approvalInfo,
      dryRun: { outputUsd: dryRunResult.outputUsd, ok: true },
      send: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
