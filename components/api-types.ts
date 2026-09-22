// Hand-declared to mirror the JSON each API route actually returns — not
// imported from lib/, on purpose. Components consume the HTTP contract,
// not internal server types; if a lib/ type's shape changes, the route's
// JSON response (and this file) is what has to be updated, not the other
// way around. See architecture.test.ts for the rule this enforces:
// nothing under components/ or app/ (except app/api/**/route.ts) may
// import from lib/ at all.

export type PipelineMode = "simulation" | "dry-run" | "live";

export type PipelineOutcome =
  | "blocked"
  | "error"
  | "simulated"
  | "dry_run_failed"
  | "dry_run_only"
  | "executed"
  | "send_failed";

export interface StatusResponse {
  binanceWeb3Api: { configured: boolean };
  groq: { configured: boolean };
  bscRpc: { configured: boolean };
  agenticWallet: { configured: boolean };
  wallet: { tradingCapitalUsd: number | null; operatingBudgetUsd: number | null; reason?: string };
  killswitch: PipelineMode;
}

export interface ProposedOrder {
  ticker: string;
  side: "buy" | "sell";
  sizeUsd: number;
  adjustedSpread: number;
  price: number;
  recentTicks: number[];
  liquidityDepthUsd: number;
  simulatedOutputUsd: number;
}

export interface GuardrailCheckResult {
  name: string;
  ok: boolean;
  reason?: string;
}

export interface GuardrailVerdict {
  approved: boolean;
  status: "approved" | "blocked" | "error";
  reason: string;
  blockedBy?: string;
  approvedSizeUsd?: number;
  checks: GuardrailCheckResult[];
  timestamp: number;
  input: ProposedOrder;
}

export interface UnderlyingSpread {
  ticker: string;
  priceReturnPrice: number;
  totalReturnPrice: number;
  navEquivalentPrice: number;
  liquidityDepthUsd: number;
  rawSpread: number;
  adjustedSpread: number;
}

export interface SpreadHistoryPoint {
  date: string;
  priceReturnPrice: number;
  totalReturnPrice: number;
  rawSpread: number;
  adjustedSpread: number;
}

export interface PreviewOpportunity {
  ticker: string;
  order: ProposedOrder;
  narration: string;
  verdict: GuardrailVerdict;
}

export interface OpportunitiesResponse {
  spreads: UnderlyingSpread[];
  opportunities: PreviewOpportunity[];
  history: Record<string, SpreadHistoryPoint[]>;
  error?: string;
}

export interface AuditLedgerEntry {
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: PipelineOutcome;
  verdict: GuardrailVerdict;
  dryRun?: { outputUsd: number; ok: boolean; reason?: string };
  send?: { txId: string } | { error: string };
}

export interface LedgerResponse {
  entries: AuditLedgerEntry[];
}

export interface KillswitchResponse {
  mode: PipelineMode;
}

export interface InstructionSuccess {
  ok: true;
  ticker: string;
  order: ProposedOrder;
  narration: string;
  verdict: GuardrailVerdict;
  outcome: PipelineOutcome;
  ledgerEntryId: string;
}
