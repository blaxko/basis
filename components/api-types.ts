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
  | "tolerance_exceeds_edge"
  | "two_leg_execution_not_implemented"
  | "spread_closed"
  | "approval_failed"
  | "dry_run_failed"
  | "dry_run_only"
  | "executed"
  | "send_failed";

export type LedgerOutcome = PipelineOutcome | "no_opportunity" | "warming_up";

export interface BinanceCallRecord {
  at: string;
  method: "GET" | "POST";
  path: string;
  query: string;
  httpStatus: number | null;
  latencyMs: number;
  apiCode: number | null;
  ok: boolean;
  error?: string;
}

export interface StatusResponse {
  groq: { configured: boolean };
  bscRpc: { configured: boolean };
  tradingWallet: { configured: boolean };
  binanceWeb3Api: {
    configured: boolean;
    summary: {
      count: number;
      ok: number;
      failed: number;
      latencyMs: { p50: number | null; p95: number | null; max: number | null };
    };
    calls: BinanceCallRecord[]; // newest first
  };
  wallet: { tradingCapitalUsd: number | null; operatingBudgetUsd: number | null; reason?: string };
  killswitch: PipelineMode;
}

export type ReferenceQuote =
  | { status: "ok"; priceUsd: number; vendor: string; route: string }
  | { status: "unavailable"; reason: string };

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
  expensivePrice: number;
  expensiveRecentTicks: number[];
  liquidityDepthUsd: number;
  simulatedOutputUsd: number | null;
  poolPair: PoolPair;
  reference: ReferenceQuote;
}

export interface GuardrailCheckResult {
  name: string;
  ok: boolean;
  reason?: string;
  // Failed for lack of price history. Never shown as a pass.
  warmingUp?: boolean;
  // Had no data to run on yet. Never shown as a pass.
  pending?: boolean;
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
  gas: { costUsd: number; source: "live" | "fallback" };
}

export interface WarmUpStatus {
  readings: number;
  required: number;
  complete: boolean;
}

export interface SpreadHistoryPoint {
  timestamp: string;
  cheapPoolPriceUsd: number;
  cheapPoolFeeUnits: number;
  expensivePoolPriceUsd: number;
  expensivePoolFeeUnits: number;
  rawSpread: number;
  adjustedSpread: number;
  reference: ReferenceQuote | null;
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
  warmUp: Record<string, WarmUpStatus>;
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
  gas: { costUsd: number; source: "live" | "fallback" };
  reference: ReferenceQuote;
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

export interface DetectionLedgerEntry {
  kind: "detection";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "no_opportunity" | "warming_up";
  detection: DetectionSnapshot;
  warmUp?: { readings: number; required: number };
}

export type AuditLedgerEntry = PipelineLedgerEntry | DetectionLedgerEntry;

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
