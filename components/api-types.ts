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
  publicReadOnly: boolean;
  requestClientIp: string;
  groq: { configured: boolean };
  bscRpc: { configured: boolean };
  tradingWallet: { configured: boolean; address: string | null; error?: string };
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
  killswitch: PipelineMode;
  // Public demo only: ISO time the mode returns to simulation, or null.
  killswitchRevertsAt: string | null;
  // Latest underlying-market status per ticker (RWA Data API).
  marketStatus: Record<string, MarketStatus>;
  scheduler: { running: boolean; tickInFlight: boolean; skippedTicks: number; lastSkippedAt: string | null };
  walletBalances:
    | { status: "ok"; address: string; bnb: string; usdt: string; msftb: string; msftbToken: string; blockNumber: string; readAt: string }
    | { status: "unavailable"; reason: string; readAt: string };
}

export type ReferenceQuote =
  | { status: "ok"; priceUsd: number; vendor: string; route: string }
  | { status: "unavailable"; reason: string };

// Mirrors lib/data/binance-rwa.ts: the underlying market's status from
// the RWA Data API. Decisions use reasonCode only.
export type MarketStatus =
  | {
      status: "ok";
      openState: boolean;
      reasonCode: string | null;
      marketStatus: string | null;
      reasonMsg: string | null;
      nextOpenTime: number | null;
      nextCloseTime: number | null;
      fetchedAt: string;
    }
  | { status: "unavailable"; reason: string; fetchedAt: string };

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
  marketStatus: MarketStatus;
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
  marketStatus: MarketStatus;
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
  // orderId: Binance's broadcast-transaction id for the same transaction.
  approval?: { needed: boolean; txId?: string; orderId?: string; error?: string };
  dryRun?: { outputUsd: number; ok: boolean; reason?: string };
  transactionSimulation?: TxSimulation;
  send?: { txId: string; orderId?: string } | { error: string };
}

// Mirrors lib/data/binance-transaction.ts's TxSimulation (balance and
// allowance change shapes kept loose; the UI only counts them).
export type TxSimulation =
  | { result: "succeeded"; status: string; balanceChanges: unknown[]; allowanceChanges: unknown[] }
  | { result: "failed"; status: string; failReason: string }
  | { result: "unavailable"; reason: string };

export interface DetectionLedgerEntry {
  kind: "detection";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "no_opportunity" | "warming_up";
  detection: DetectionSnapshot;
  warmUp?: { readings: number; required: number };
}

export interface ExecutionTestLeg {
  side: "buy" | "sell";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  quotedAmountOut?: string;
  amountOutMinimum?: string;
  approval?: { needed: boolean; txId?: string; pendingTxId?: string; orderId?: string };
  transactionSimulation?: TxSimulation;
  txId?: string;
  // Binance's broadcast-transaction orderId for the swap (with txId or
  // pendingTxId).
  orderId?: string;
  pendingTxId?: string;
  received?: string;
  error?: string;
}

// The manual execution test — never an arbitrage decision.
export interface ExecutionTestLedgerEntry {
  kind: "execution_test";
  id: string;
  timestamp: number;
  action: "round_trip" | "sell_only";
  mode: PipelineMode;
  outcome: "refused" | "buy_failed" | "sell_failed" | "completed";
  sizeUsd: number;
  pool: { address: string; feeUnits: number };
  reason?: string;
  legs: ExecutionTestLeg[];
  spendRecordedUsd: number;
  targetBalanceAfter?: string;
}

// A scheduler tick skipped because the previous one was still running.
export interface SchedulerLedgerEntry {
  kind: "scheduler";
  id: string;
  timestamp: number;
  mode: PipelineMode;
  outcome: "tick_skipped";
  runningTickStartedAt: string;
  runningForMs: number;
}

export type AuditLedgerEntry = PipelineLedgerEntry | DetectionLedgerEntry | ExecutionTestLedgerEntry | SchedulerLedgerEntry;

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
