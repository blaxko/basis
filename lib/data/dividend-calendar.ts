import type { DividendEvent } from "./types";

// Hardcoded for the MVP demo set (PRD section 10: mocked, not a full
// corporate-actions feed). Covers the four underlyings confirmed live
// across xStocks, bStocks, and Ondo: NVDA, AAPL, MSFT, TSLA.
// TSLA intentionally carries no entries — it pays no dividend, and is
// kept in the set as the "zero accrual" control case.
export const DIVIDEND_CALENDAR: DividendEvent[] = [
  { symbol: "NVDA", exDivDate: "2025-09-11", amountPerShare: 0.01 },
  { symbol: "AAPL", exDivDate: "2025-08-11", amountPerShare: 0.26 },
  { symbol: "MSFT", exDivDate: "2025-08-21", amountPerShare: 0.83 },
];

// Sums dividends whose ex-dividend date has passed as of `asOfDate`.
// This is the estimated component reflected in the Ondo (total-return)
// price but absent from the xStocks/bStocks (price-return) price —
// it's what navEquivalent() strips back out.
export function accruedDividend(symbol: string, asOfDate: string): number {
  return DIVIDEND_CALENDAR.filter(
    (event) => event.symbol === symbol && event.exDivDate <= asOfDate
  ).reduce((sum, event) => sum + event.amountPerShare, 0);
}
