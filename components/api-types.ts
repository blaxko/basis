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
  | "no_edge"
  | "spread_closed"
  | "approval_failed"
  | "dry_run_failed"
  | "dry_run_only"
  | "executed"
  | "send_failed";

export type LedgerOutcome = PipelineOutcome | "no_opportunity";

export interface StatusResponse {
  groq: { configured: boolean };
  bscRpc: { configured: boolean };
  tradingWallet: { configured: boolean };
  wallet: { tradingCapitalUsd: number | null; operatingBudgetUsd: number | null; reason?: string };
  killswitch: PipelineMode;
}

export interface PoolPair {
  cheapPoolAddress: string;
  cheapPoolFeeUnits: number;
  expensivePoolAddress: string;
  expensivePoolFeeUnits: number;
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
  poolPair: PoolPair;
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

export interface PoolLeg {
  address: string;
  priceUsd: number;
  feeUnits: number;
  liquidityUsdEstimate: number;
}

export interface UnderlyingSpread {
  ticker: string;
  cheapPool: PoolLeg;
  expensivePool: PoolLeg;
  rawSpread: number;
  adjustedSpread: number;
}

export interface SpreadHistoryPoint {
  timestamp: string;
  cheapPoolPriceUsd: number;
  cheapPoolFeeUnits: number;
  expensivePoolPriceUsd: number;
  expensivePoolFeeUnits: number;
  rawSpread: number;
  adjustedSpread: number;
}

// "live": every automatic evaluation the scheduler recorded in the audit
// ledger this server session. "historical": the seeded fixture
// (lib/data/demo-history.ts), shown only when no live evaluation exists.
export interface SpreadSeries {
  source: "live" | "historical";
  points: SpreadHistoryPoint[];
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
  history: Record<string, SpreadSeries>;
  threshold: number;
  error?: string;
}

export interface PoolReading {
  address: string;
  feeUnits: number;
  priceUsd: number;
}

export interface DetectionSnapshot {
  ticker: string;
  cheapPool: PoolReading;
  expensivePool: PoolReading;
  grossGap: number;
  netEdge: number;
  threshold: number;
}

export interface PipelineLedgerEntry {
  kind: "pipeline";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: PipelineOutcome;
  verdict: GuardrailVerdict;
  detection?: DetectionSnapshot;
  freshness?: { freshSpread: number; ok: boolean; reason?: string };
  approval?: { needed: boolean; txId?: string; error?: string };
  dryRun?: { outputUsd: number; ok: boolean; reason?: string };
  send?: { txId: string } | { error: string };
}

export interface NoOpportunityLedgerEntry {
  kind: "detection";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "no_opportunity";
  detection: DetectionSnapshot;
}

export type AuditLedgerEntry = PipelineLedgerEntry | NoOpportunityLedgerEntry;

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
