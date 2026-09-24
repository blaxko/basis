// Orphaned: the product pivoted from dividend/total-return arbitrage to
// cross-pool AMM fee-tier spread arbitrage (see docs/PRD.md section 5b,
// "Research Summary — What Already Works, and Why," for why: empirical
// checks found xStocks/bStocks are themselves dividend-reinvesting
// rebase tokens, not price-return instruments, so no genuine price-return
// vs total-return gap exists to detect). Protocol/Quote/DividendEvent are
// unused by the current detection path (see PoolQuote below) but left in
// place rather than deleted, since lib/execution/pipeline.ts's existing
// Binance-aggregator execution path still references the old
// token-addresses.ts registry built on this shape.
export type Protocol = "xstocks" | "bstocks" | "ondo";

export interface Quote {
  protocol: Protocol;
  underlying: string;
  symbol: string;
  price: number;
  liquidityDepth: number;
  timestamp: number;
}

export interface DividendEvent {
  symbol: string;
  exDivDate: string; // YYYY-MM-DD
  amountPerShare: number;
}

// A single PancakeSwap V3 pool's live price for one ticker's token,
// paired against a stablecoin. The new detection unit: a ticker maps to
// N of these (one per fee-tier pool), not one aggregated quote.
export interface PoolQuote {
  ticker: string;
  poolAddress: string;
  feeUnits: number; // PancakeSwap's own scale: 1 unit = 1e-6 (2500 = 0.25%, 10000 = 1%)
  priceUsd: number;
  liquidityUsdEstimate: number; // near-current-tick estimate, see pancakeswap-v3.ts's estimateLiquidityUsd
  timestamp: number;
}
