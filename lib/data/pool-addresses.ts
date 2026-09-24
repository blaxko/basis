// PancakeSwap V3 pool addresses per ticker, one entry per fee tier.
// Seeded only with addresses genuinely verified this session (confirmed
// live via on-chain slot0()/token0()/token1() reads against BSC mainnet,
// not fabricated or guessed) — every other ticker stays unregistered
// until independently confirmed the same way. See getPoolsForTicker()'s
// NotImplemented throw, same pattern as lib/data/token-addresses.ts.
export interface PoolDescriptor {
  address: string;
  feeUnits: number; // PancakeSwap's own scale: 1 unit = 1e-6 (2500 = 0.25%, 10000 = 1%)
}

const POOL_ADDRESSES: Record<string, PoolDescriptor[]> = {
  // MSFTB/USDT pools on PancakeSwap V3 (BSC). Both confirmed live
  // on-chain: token0 = USDT (0x55d398326f99059fF775485246999027B3197955,
  // 18 decimals), token1 = MSFTB (0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0,
  // 18 decimals).
  MSFT: [
    { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500 }, // 0.25%
    { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000 }, // 1%
  ],
};

export function getPoolsForTicker(ticker: string): PoolDescriptor[] {
  const pools = POOL_ADDRESSES[ticker];
  if (!pools || pools.length === 0) {
    throw new Error(
      `NotImplemented: no confirmed PancakeSwap V3 pool addresses for ${ticker} yet — ` +
        "see lib/data/pool-addresses.ts. Refusing to fabricate a pool address."
    );
  }
  return pools;
}
