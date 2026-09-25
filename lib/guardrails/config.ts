// Hard-coded guardrail config for this phase. PRD section 12 rule 4/1: a
// real value source (per-user config, env-driven, etc.) comes later —
// this phase just needs the caps enforced structurally, not documented.
export interface GuardrailConfig {
  perTradeCapUsd: number;
  perDayCapUsd: number;
  // simulatedOutput must be at least this fraction of the proposed size
  // (e.g. 0.98 = simulated output can't fall more than 2% short).
  minDryRunOutputRatio: number;
  maxPriceDeviationPct: number;
  minLiquidityDepthUsd: number;
  // The fresh, immediately-pre-send cross-pool spread must retain at
  // least this fraction of the originally detected spread — the MEV/
  // front-running mitigation for bypassing Binance's aggregator (which
  // would otherwise absorb this risk). A ratio, not an absolute bps
  // threshold, matching minDryRunOutputRatio's pattern: real edges here
  // are small fractions of a percent, so an absolute cutoff would need
  // constant re-tuning per pairing, while a retention ratio generalizes.
  // 0.5 is a starting point (fresh edge must still be at least half the
  // detected edge), not empirically tuned — review once live spread
  // volatility over a real detection-to-send window is observed.
  minSpreadRetentionRatio: number;
  // Price readings required per pool before priceSanityCheck can pass
  // and before any order is proposed. Below this, the system is warming
  // up after a server start. 10 readings = 5 minutes at the 30s tick.
  minPriceHistoryReadings: number;
  // amountOutMinimum on the swap = simulated output × (1 − this). A
  // fraction, e.g. 0.0005 = 0.05%. An order is refused when this is not
  // strictly below its expected net edge: an on-chain floor looser than
  // the edge can't protect it. See docs/config-rationale.md.
  sendSlippageTolerance: number;
  // The cheap pool's fee-inclusive buy price may differ from Binance's
  // aggregator quote for the same token and size by at most this fraction
  // (0.02 = 2%). An independent reference against corrupted or
  // manipulated pool reads. See docs/config-rationale.md.
  maxReferenceDivergencePct: number;
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  perTradeCapUsd: 500,
  perDayCapUsd: 2000,
  minDryRunOutputRatio: 0.98,
  maxPriceDeviationPct: 0.05,
  minLiquidityDepthUsd: 1000,
  minSpreadRetentionRatio: 0.5,
  minPriceHistoryReadings: 10,
  sendSlippageTolerance: 0.0005,
  maxReferenceDivergencePct: 0.02,
};
