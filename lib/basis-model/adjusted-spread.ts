// rawSpread is diagnostic-only. It is what a naive bot would diff
// directly and is exactly the signal that false-positives around
// ex-dividend dates — per PRD rule 6, it must never be used as an
// execution signal. Exported here only so the suppression test can
// prove the difference against adjustedSpread.
export function rawSpread(totalReturnPrice: number, priceReturnPrice: number): number {
  return (totalReturnPrice - priceReturnPrice) / priceReturnPrice;
}

// The only signal this system is permitted to act on: the spread
// between the dividend-adjusted NAV-equivalent and the price-return leg.
export function adjustedSpread(navEquivalentPrice: number, priceReturnPrice: number): number {
  return (navEquivalentPrice - priceReturnPrice) / priceReturnPrice;
}
