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
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  perTradeCapUsd: 500,
  perDayCapUsd: 2000,
  minDryRunOutputRatio: 0.98,
  maxPriceDeviationPct: 0.05,
  minLiquidityDepthUsd: 1000,
};
