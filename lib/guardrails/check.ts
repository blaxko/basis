import { priceSanityCheck, liquidityDepthCheck } from "../basis-model/sanity-checks";
import type { ReferenceQuote } from "../data/binance-reference";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "./config";

export type { ReferenceQuote } from "../data/binance-reference";

export type Side = "buy" | "sell";

// The cross-pool arbitrage is inherently two-legged (buy cheap, sell
// expensive) — required, not optional, so every downstream consumer
// (check(), spreadFreshnessCheck's pipeline wiring, buildSwapRequest())
// can rely on it existing rather than handling a missing case. Both
// construction sites (lib/orchestration/agent-loop.ts's automatic
// detection, lib/orchestration/handle-instruction.ts's manual resolution
// step) are responsible for populating this correctly before a
// ProposedOrder can exist at all — there is no partially-built order.
export interface PoolPair {
  cheapPoolAddress: string;
  cheapPoolFeeUnits: number;
  expensivePoolAddress: string;
  expensivePoolFeeUnits: number;
}

// A structured order the LLM/opportunity layer proposes. The gate never
// sees a wallet, a signer, or a transaction — only this plain data.
export interface ProposedOrder {
  ticker: string;
  side: Side;
  sizeUsd: number;
  adjustedSpread: number;
  // Cheap pool's price and its recent readings.
  price: number;
  recentTicks: number[];
  // Expensive pool's too — a bad reading on either side can fake an edge.
  expensivePrice: number;
  expensiveRecentTicks: number[];
  liquidityDepthUsd: number;
  // null until a real QuoterV2 simulation has run. The order builders
  // never have one, so check() reports the dry-run floor as pending
  // rather than passing it; the pipeline runs the same check against the
  // real simulated output before any send.
  simulatedOutputUsd: number | null;
  poolPair: PoolPair;
  // Binance's aggregator quote for buying the same token at the same
  // size, fetched by the order builder. check() never fetches it.
  reference: ReferenceQuote;
}

// Caller-supplied context the gate needs but must not compute itself,
// since check() has to stay pure. spentTodaySoFarUsd is a plain number,
// not an injected function: the caller (whatever eventually reads the
// real spend ledger) resolves "spend so far today" before calling
// check(), so check() itself never reaches out to any store.
export interface GuardrailDeps {
  spentTodaySoFarUsd: number;
  config?: GuardrailConfig;
}

export interface GuardrailCheckResult {
  name: string;
  ok: boolean;
  reason?: string;
  // Failed only for lack of history (ok is false). Displayed as
  // "warming up", never as a pass.
  warmingUp?: boolean;
  // The check has no data to run on yet (ok is true so it doesn't block,
  // but it did not pass). Displayed as "pending", never as a pass.
  pending?: boolean;
}

// The gate's decision. Deliberately includes enough structure (checks[],
// timestamp, input echo) to be appended directly to an audit ledger later
// (PRD rule 8) without reshaping this type.
export interface GuardrailVerdict {
  approved: boolean;
  // Distinguishes a genuine guardrail rejection from an internal fault —
  // both resolve to approved: false, but a ledger view needs to tell
  // "the gate correctly blocked this" apart from "the gate itself broke"
  // (PRD rule 8/9, architecture section 7).
  status: "approved" | "blocked" | "error";
  reason: string;
  // Name of the check that caused the block, set only when status is
  // "blocked" — lets a ledger row render the failing check without
  // rescanning `checks` for the first ok: false entry.
  blockedBy?: string;
  approvedSizeUsd?: number;
  checks: GuardrailCheckResult[];
  timestamp: number;
  input: ProposedOrder;
}

// Named check 1: reuses the Basis Model's sanity-bounds and
// liquidity-depth checks as an early gate rather than reimplementing
// them (PRD rule 7). Runs first — a corrupted or illiquid feed shouldn't
// even reach the spend-cap arithmetic below.
export function sanityAndLiquidityCheck(
  order: ProposedOrder,
  config: GuardrailConfig
): GuardrailCheckResult {
  const pools = [
    { label: "cheap pool", price: order.price, ticks: order.recentTicks },
    { label: "expensive pool", price: order.expensivePrice, ticks: order.expensiveRecentTicks },
  ];
  for (const pool of pools) {
    const result = priceSanityCheck(pool.price, pool.ticks, config.maxPriceDeviationPct, config.minPriceHistoryReadings);
    if (!result.ok) {
      return {
        name: "sanityAndLiquidity",
        ok: false,
        reason: `${pool.label}: ${result.reason}`,
        ...(result.warmingUp ? { warmingUp: true } : {}),
      };
    }
  }
  const liquidityResult = liquidityDepthCheck(order.liquidityDepthUsd, config.minLiquidityDepthUsd);
  if (!liquidityResult.ok) {
    return { name: "sanityAndLiquidity", ok: false, reason: liquidityResult.reason };
  }
  return { name: "sanityAndLiquidity", ok: true };
}

// Named check 1b: the buy-leg (cheap) pool's spot price against the
// Binance aggregator's quote-implied price for the same token and size.
// A pool reading far from an independent quote is treated as bad data.
// Spot, not fee-inclusive: a pool's own fee isn't a price error, and
// adding it would spend most of the budget on the 1% pool before any
// data error (measured 2026-09-25: 0.13% spot vs 0.87% fee-inclusive;
// docs/devex-log.md). No reference, no trade: an unavailable quote
// fails closed.
export function referencePriceCheck(order: ProposedOrder, config: GuardrailConfig): GuardrailCheckResult {
  if (order.reference.status !== "ok") {
    return {
      name: "referencePrice",
      ok: false,
      reason: `no Binance reference quote: ${order.reference.reason}`,
    };
  }
  const reference = order.reference.priceUsd;
  const divergence = Math.abs(order.price - reference) / reference;
  if (!Number.isFinite(divergence) || divergence > config.maxReferenceDivergencePct) {
    return {
      name: "referencePrice",
      ok: false,
      reason: `buy-leg pool price $${order.price.toFixed(4)} is ${(divergence * 100).toFixed(2)}% from the Binance reference $${reference.toFixed(4)} (${order.reference.vendor}), over the ${(config.maxReferenceDivergencePct * 100).toFixed(2)}% limit`,
    };
  }
  return { name: "referencePrice", ok: true };
}

// Named check 2: hard per-trade spend cap.
export function perTradeCapCheck(order: ProposedOrder, config: GuardrailConfig): GuardrailCheckResult {
  if (order.sizeUsd > config.perTradeCapUsd) {
    return {
      name: "perTradeCap",
      ok: false,
      reason: `order size $${order.sizeUsd} exceeds per-trade cap $${config.perTradeCapUsd}`,
    };
  }
  return { name: "perTradeCap", ok: true };
}

// Named check 3: cumulative per-day spend cap. This is the ordering the
// PRD calls out (rule 4) — spend limits are checked before anything
// downstream could act on the order, so a caller must inspect the
// verdict before proceeding to any execution step.
export function dailyCapCheck(
  order: ProposedOrder,
  deps: GuardrailDeps,
  config: GuardrailConfig
): GuardrailCheckResult {
  const projectedSpend = deps.spentTodaySoFarUsd + order.sizeUsd;
  if (projectedSpend > config.perDayCapUsd) {
    return {
      name: "dailyCap",
      ok: false,
      reason: `projected daily spend $${projectedSpend} (already spent $${deps.spentTodaySoFarUsd} + order $${order.sizeUsd}) exceeds daily cap $${config.perDayCapUsd}`,
    };
  }
  return { name: "dailyCap", ok: true };
}

// Named check 4: dry-run minimum-output floor, against a real QuoterV2
// simulation (PRD rule 3). Before one exists it is pending, not passed;
// lib/execution/pipeline.ts re-runs it on the simulated output.
export function dryRunFloorCheck(order: ProposedOrder, config: GuardrailConfig): GuardrailCheckResult {
  if (order.simulatedOutputUsd === null) {
    return {
      name: "dryRunFloor",
      ok: true,
      pending: true,
      reason: "no simulation yet — runs on the QuoterV2 output before any send",
    };
  }
  const minRequired = order.sizeUsd * config.minDryRunOutputRatio;
  if (order.simulatedOutputUsd < minRequired) {
    return {
      name: "dryRunFloor",
      ok: false,
      reason: `simulated output $${order.simulatedOutputUsd} is below the required floor $${minRequired} (${config.minDryRunOutputRatio * 100}% of order size $${order.sizeUsd})`,
    };
  }
  return { name: "dryRunFloor", ok: true };
}

// Named check 5: NOT part of check()'s own array below, on purpose —
// unlike the other four, this one needs a value (freshSpread) that only
// exists after a live re-read, which check() itself must never perform
// (it has to stay pure). Same pattern as dryRunFloorCheck's reuse in
// lib/execution/pipeline.ts as a belt-and-suspenders re-check against
// freshly-observed data: pipeline.ts re-reads both pools immediately
// before send() and calls this directly. The MEV/front-running
// mitigation for bypassing Binance's aggregator — fails closed if the
// edge has decayed past the retention floor or inverted outright.
export function spreadFreshnessCheck(
  detectedSpread: number,
  freshSpread: number,
  config: GuardrailConfig
): GuardrailCheckResult {
  if (freshSpread <= 0) {
    return {
      name: "spreadFreshness",
      ok: false,
      reason: `fresh spread ${(freshSpread * 100).toFixed(4)}% is no longer positive — the edge has closed or inverted since detection`,
    };
  }

  const retention = detectedSpread > 0 ? freshSpread / detectedSpread : 0;
  if (retention < config.minSpreadRetentionRatio) {
    return {
      name: "spreadFreshness",
      ok: false,
      reason: `fresh spread ${(freshSpread * 100).toFixed(4)}% retains only ${(retention * 100).toFixed(1)}% of the detected spread ${(detectedSpread * 100).toFixed(4)}%, below the required ${(config.minSpreadRetentionRatio * 100).toFixed(0)}% retention floor`,
    };
  }

  return { name: "spreadFreshness", ok: true };
}

// Named check 6: like spreadFreshness, invoked from lib/execution/pipeline.ts
// (against the detected edge, then again against the fresh one), not from
// check() — for a non-positive edge the pipeline's no_edge gate has
// already declined, and comparing a tolerance to it would be meaningless.
// The swap's on-chain floor is simulated output × (1 − tolerance). If the
// tolerance is not strictly below the net edge, the floor can let the
// whole edge (or more) go and the swap would still succeed.
export function slippageToleranceCheck(netEdge: number, config: GuardrailConfig): GuardrailCheckResult {
  if (config.sendSlippageTolerance >= netEdge) {
    return {
      name: "slippageTolerance",
      ok: false,
      reason: `on-chain slippage tolerance ${(config.sendSlippageTolerance * 100).toFixed(4)}% is not below the net edge ${(netEdge * 100).toFixed(4)}% — the swap's minimum-output floor couldn't protect it`,
    };
  }
  return { name: "slippageTolerance", ok: true };
}

// The gate. Pure and side-effect-free: no wallet calls, no network calls,
// no signing — it only decides, and a caller must check verdict.approved
// before proceeding to anything downstream (PRD rules 1 and 4).
//
// Fails closed (PRD rule 9): any named check failing, or any unexpected
// internal error (e.g. malformed input the type system didn't catch),
// resolves to a blocked verdict — never a silent approval.
export function check(order: ProposedOrder, deps: GuardrailDeps): GuardrailVerdict {
  const timestamp = Date.now();
  const config = deps.config ?? DEFAULT_GUARDRAIL_CONFIG;

  try {
    const checks: GuardrailCheckResult[] = [
      sanityAndLiquidityCheck(order, config),
      referencePriceCheck(order, config),
      perTradeCapCheck(order, config),
      dailyCapCheck(order, deps, config),
      dryRunFloorCheck(order, config),
    ];

    const failed = checks.find((c) => !c.ok);
    if (failed) {
      return {
        approved: false,
        status: "blocked",
        blockedBy: failed.name,
        reason: failed.reason ?? `${failed.name} check failed`,
        checks,
        timestamp,
        input: order,
      };
    }

    const pending = checks.filter((c) => c.pending).map((c) => c.name);
    return {
      approved: true,
      status: "approved",
      reason:
        pending.length === 0
          ? "all guardrail checks passed"
          : `all runnable guardrail checks passed; pending until simulation: ${pending.join(", ")}`,
      approvedSizeUsd: order.sizeUsd,
      checks,
      timestamp,
      input: order,
    };
  } catch (err) {
    // Fail closed on unexpected internal errors too — ambiguity defaults
    // to no, never to silent approval.
    return {
      approved: false,
      status: "error",
      reason: `guardrail gate encountered an internal error: ${err instanceof Error ? err.message : String(err)}`,
      checks: [],
      timestamp,
      input: order,
    };
  }
}
