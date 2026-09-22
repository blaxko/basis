// Strips the accrued (reinvested) dividend component out of a
// total-return (Ondo) price, producing a NAV-equivalent that's
// comparable to a price-return (xStocks/bStocks) price. This is the
// TradFi NAV analogue described in PRD section 4/5b — never diff Ondo's
// raw price against a price-return price directly.
export function navEquivalent(ondoPrice: number, accruedDividendPerShare: number): number {
  return ondoPrice - accruedDividendPerShare;
}
