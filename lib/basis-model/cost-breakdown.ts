import { feeAdjustedPrice } from "./nav-equivalent";
import { adjustedSpread, rawSpread } from "./adjusted-spread";

// The dashboard's cost table: from the gross gap between the two pools to
// the net edge, one line per cost. Computed with the Basis Model's own
// functions (feeAdjustedPrice, rawSpread, adjustedSpread), and the fee
// lines are taken in sequence so the lines add up exactly:
//
//   grossGap + buyFee + sellFee + slippage + gas = netEdge
//
// where netEdge is adjustedSpread() itself — the same number the detector
// uses and the rest of the dashboard shows.

export interface CostBreakdownInput {
  cheapPriceUsd: number; // the pool Basis would buy on
  cheapFeeUnits: number;
  dearPriceUsd: number; // the pool it would sell on
  dearFeeUnits: number;
  slippagePct: number;
  gasCostUsd: number; // both legs
  tradeSizeUsd: number;
}

export interface CostLine {
  key: "buyFee" | "sellFee" | "slippage" | "gas";
  pct: number; // share of the order (negative: a cost)
  usd: number; // the same cost in dollars on the order (positive)
  feeUnits?: number; // for the fee lines: PancakeSwap's scale, 2500 = 0.25%
}

export interface CostBreakdown {
  grossGap: number;
  lines: CostLine[];
  totalCostPct: number; // sum of the lines (negative)
  netEdge: number; // adjustedSpread()
  tradeSizeUsd: number;
}

export function costBreakdown(i: CostBreakdownInput): CostBreakdown {
  const buyEff = feeAdjustedPrice(i.cheapPriceUsd, i.cheapFeeUnits, "buy");
  const sellEff = feeAdjustedPrice(i.dearPriceUsd, i.dearFeeUnits, "sell");
  const grossGap = rawSpread(i.cheapPriceUsd, i.dearPriceUsd);
  const afterBuyFee = (i.dearPriceUsd - buyEff) / buyEff;
  const netOfFees = (sellEff - buyEff) / buyEff;
  const gasPct = i.tradeSizeUsd > 0 ? -i.gasCostUsd / i.tradeSizeUsd : 0;

  const pcts: Array<Omit<CostLine, "usd">> = [
    { key: "buyFee", pct: afterBuyFee - grossGap, feeUnits: i.cheapFeeUnits },
    { key: "sellFee", pct: netOfFees - afterBuyFee, feeUnits: i.dearFeeUnits },
    { key: "slippage", pct: -i.slippagePct },
    { key: "gas", pct: gasPct },
  ];
  const lines: CostLine[] = pcts.map((l) => ({ ...l, usd: l.key === "gas" ? i.gasCostUsd : -l.pct * i.tradeSizeUsd }));

  return {
    grossGap,
    lines,
    totalCostPct: lines.reduce((a, l) => a + l.pct, 0),
    netEdge: adjustedSpread({
      effectiveBuyPriceUsd: buyEff,
      effectiveSellPriceUsd: sellEff,
      slippagePct: i.slippagePct,
      gasCostUsd: i.gasCostUsd,
      tradeSizeUsd: i.tradeSizeUsd,
    }),
    tradeSizeUsd: i.tradeSizeUsd,
  };
}
