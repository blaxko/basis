// rawSpread is diagnostic-only. It is what a naive bot would diff
// directly — the raw price gap between two pools of the same token,
// ignoring every real cost of actually capturing it. It must never be
// used as an execution signal (same rule as before the mechanism swap,
// now for a different reason: a positive raw gap routinely doesn't
// survive fees, per the real MSFTB case this module's tests are built
// against).
export function rawSpread(cheapPoolPriceUsd: number, expensivePoolPriceUsd: number): number {
  return (expensivePoolPriceUsd - cheapPoolPriceUsd) / cheapPoolPriceUsd;
}

export interface AdjustedSpreadInput {
  effectiveBuyPriceUsd: number; // feeAdjustedPrice() of the cheap pool, side "buy"
  effectiveSellPriceUsd: number; // feeAdjustedPrice() of the expensive pool, side "sell"
  slippagePct: number; // estimated slippage for the trade size, as a fraction
  gasCostUsd: number; // estimated gas cost for both legs, in USD
  tradeSizeUsd: number;
}

// The only signal this system is permitted to act on: the net edge of
// buying on the cheap pool and selling on the expensive pool, after both
// pools' own fees (already baked into the two effective prices via
// feeAdjustedPrice()), estimated slippage for the trade size, and gas —
// expressed as a fraction of trade size. Positive means a genuinely
// tradeable edge; zero or negative means the raw gap doesn't survive
// real costs and nothing should execute.
export function adjustedSpread(input: AdjustedSpreadInput): number {
  const netOfFees = (input.effectiveSellPriceUsd - input.effectiveBuyPriceUsd) / input.effectiveBuyPriceUsd;
  const gasFraction = input.tradeSizeUsd > 0 ? input.gasCostUsd / input.tradeSizeUsd : 0;
  return netOfFees - input.slippagePct - gasFraction;
}
