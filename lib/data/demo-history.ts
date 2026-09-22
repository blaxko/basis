import { navEquivalent } from "../basis-model/nav-equivalent";
import { rawSpread, adjustedSpread } from "../basis-model/adjusted-spread";
import { accruedDividend } from "./dividend-calendar";

export interface SpreadHistoryPoint {
  date: string; // YYYY-MM-DD (UTC)
  priceReturnPrice: number;
  totalReturnPrice: number;
  rawSpread: number;
  adjustedSpread: number;
}

// Seeded demo fixture, not live data: GET /api/opportunities can only
// ever report a single current snapshot per underlying (there's no tick
// history store), so there is no way to show the ex-div raw-spike vs
// adjusted-flat contrast from live quotes alone unless "today" happens
// to be an actual ex-dividend date. This reuses the exact MSFT scenario
// every phase since Phase 1 has tested against (preExDivPrice=420.00,
// dividendPerShare=0.83, exDivDate=2025-08-21) and runs it through the
// real Basis Model functions — the suppression shown here is computed,
// not hand-typed.
const MSFT_PRE_EX_DIV_PRICE = 420.0;
const MSFT_DIVIDEND_PER_SHARE = 0.83;
const MSFT_EX_DIV_DATE = "2025-08-21";

function buildMsftDemoHistory(): SpreadHistoryPoint[] {
  // xStocks/bStocks (price-return) drops by the dividend on the ex-div
  // date and holds there; Ondo (total-return) holds flat throughout
  // because the dividend is reinvested, not paid out.
  const days = [
    { date: "2025-08-18", priceReturnPrice: MSFT_PRE_EX_DIV_PRICE, totalReturnPrice: MSFT_PRE_EX_DIV_PRICE },
    { date: "2025-08-19", priceReturnPrice: MSFT_PRE_EX_DIV_PRICE, totalReturnPrice: MSFT_PRE_EX_DIV_PRICE },
    { date: "2025-08-20", priceReturnPrice: MSFT_PRE_EX_DIV_PRICE, totalReturnPrice: MSFT_PRE_EX_DIV_PRICE },
    {
      date: MSFT_EX_DIV_DATE,
      priceReturnPrice: MSFT_PRE_EX_DIV_PRICE - MSFT_DIVIDEND_PER_SHARE,
      totalReturnPrice: MSFT_PRE_EX_DIV_PRICE,
    },
    {
      date: "2025-08-22",
      priceReturnPrice: MSFT_PRE_EX_DIV_PRICE - MSFT_DIVIDEND_PER_SHARE,
      totalReturnPrice: MSFT_PRE_EX_DIV_PRICE,
    },
  ];

  return days.map(({ date, priceReturnPrice, totalReturnPrice }) => {
    const accrued = accruedDividend("MSFT", date);
    const navEq = navEquivalent(totalReturnPrice, accrued);
    return {
      date,
      priceReturnPrice,
      totalReturnPrice,
      rawSpread: rawSpread(totalReturnPrice, priceReturnPrice),
      adjustedSpread: adjustedSpread(navEq, priceReturnPrice),
    };
  });
}

const DEMO_HISTORY: Record<string, () => SpreadHistoryPoint[]> = {
  MSFT: buildMsftDemoHistory,
};

// Returns the seeded demo series for underlyings we have one for (MSFT),
// or an empty array otherwise — callers fall back to a single live point.
export function getDemoHistory(ticker: string): SpreadHistoryPoint[] {
  return DEMO_HISTORY[ticker]?.() ?? [];
}
