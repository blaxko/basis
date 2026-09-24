// BSC contract addresses for each underlying's two tradable legs. Empty
// until real addresses are confirmed from each protocol's own official
// source (xStocks, Ondo) — explicitly NOT from Binance's docs, per
// instruction, since Binance won't have them. getTokenAddresses() throws
// NotImplemented for any unregistered ticker rather than fabricating an
// address — same pattern as every credential check elsewhere in this
// codebase (lib/data/quotes.ts, lib/execution/agentic-wallet.ts, etc.).
export interface TokenAddressPair {
  priceReturn: string; // xStocks/bStocks leg contract address on BSC
  totalReturn: string; // Ondo leg contract address on BSC
}

const TOKEN_ADDRESSES: Record<string, TokenAddressPair> = {};

export function getTokenAddresses(ticker: string): TokenAddressPair {
  const pair = TOKEN_ADDRESSES[ticker];
  if (!pair) {
    throw new Error(
      `NotImplemented: no confirmed BSC contract addresses for ${ticker} yet — ` +
        "see lib/data/token-addresses.ts. Refusing to fabricate an address."
    );
  }
  return pair;
}
