// The AMM cross-pool-arbitrage analogue of the old dividend-accrual
// adjustment. Back when this vertical was dividend-driven, we stripped a
// distorting component (accrued dividend) off one leg's price before
// comparing it to the other; now the "distorting" cost is each pool's
// own swap fee, applied to whichever side of the trade that pool sits
// on — buying at a pool costs more than its quoted price by the fee,
// selling into a pool nets less than its quoted price by the fee.
//
// feeUnits is PancakeSwap's own scale: 1 unit = 1e-6 (2500 = 0.25%,
// 10000 = 1%), matching lib/data/pool-addresses.ts and the pool
// contract's own fee() return value.
export function feeAdjustedPrice(poolPriceUsd: number, feeUnits: number, side: "buy" | "sell"): number {
  const feeFraction = feeUnits / 1_000_000;
  return side === "buy" ? poolPriceUsd * (1 + feeFraction) : poolPriceUsd * (1 - feeFraction);
}
