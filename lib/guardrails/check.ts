import { priceSanityCheck, liquidityDepthCheck } from "../basis-model/sanity-checks";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig } from "./config";

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
  price: number;
  recentTicks: number[];
  liquidityDepthUsd: number;
  // Modeled input, standing in for a real dry-run/simulation API call
  // (PRD rule 3) — this phase never calls one.
  simulatedOutputUsd: number;
  poolPair: PoolPair;
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
  const priceResult = priceSanityCheck(order.price, order.recentTicks, config.maxPriceDeviationPct);
  if (!priceResult.ok) {
    return { name: "sanityAndLiquidity", ok: false, reason: priceResult.reason };
  }
  const liquidityResult = liquidityDepthCheck(order.liquidityDepthUsd, config.minLiquidityDepthUsd);
  if (!liquidityResult.ok) {
    return { name: "sanityAndLiquidity", ok: false, reason: liquidityResult.reason };
  }
  return { name: "sanityAndLiquidity", ok: true };
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

// Named check 4: dry-run minimum-output floor. simulatedOutputUsd models
// what a real dry-run/simulation call would report (PRD rule 3) — this
// phase takes it as an input rather than calling anything.
export function dryRunFloorCheck(order: ProposedOrder, config: GuardrailConfig): GuardrailCheckResult {
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

    return {
      approved: true,
      status: "approved",
      reason: "all guardrail checks passed",
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
