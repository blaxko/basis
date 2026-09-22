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
