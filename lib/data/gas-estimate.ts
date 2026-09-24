import { parseUnits, type Address } from "viem";
import {
  getPublicClient,
  getErc20Decimals,
  simulateSwapOutput,
  PANCAKE_V3_POOL_ABI,
  PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
  sqrtPriceX96ToToken1PerToken0,
} from "./pancakeswap-v3";

// Every address used here is read on-chain from the already-verified
// PancakeSwap V3 SwapRouter, not hardcoded: router.factory() and
// router.WETH9() (both in the router's Sourcify-verified ABI), then
// factory.getPool() (in the factory's Sourcify-verified ABI). Checked
// 2026-09-24: factory 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865, WETH9
// 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c (symbol() = "WBNB").
const ROUTER_IMMUTABLES_ABI = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }],
  },
] as const;

const V3_FEE_TIERS = [100, 500, 2500, 10000] as const;

// Every Ethereum-style transaction pays this before executing any code.
// QuoterV2's gasEstimate covers only the swap itself.
const INTRINSIC_TX_GAS = 21_000n;

export interface GasEstimate {
  gasCostUsd: number;
  source: "live" | "fallback";
  error?: string;
}

export interface RoundTripGasParams {
  stablecoin: Address;
  cheapPool: { address: string; feeUnits: number; priceUsd: number };
  expensivePool: { address: string; feeUnits: number; priceUsd: number };
  tradeSizeUsd: number;
  safetyMultiplier: number;
  fallbackGasCostUsd: number;
}

export interface GasEstimateDeps {
  quoteGas: (p: { tokenIn: Address; tokenOut: Address; amountIn: bigint; feeUnits: number }) => Promise<bigint>;
  getGasPriceWei: () => Promise<bigint>;
  getBnbUsd: () => Promise<number>;
  getTargetToken: (poolAddress: string, stablecoin: Address) => Promise<{ address: Address; decimals: number }>;
  warn: (message: string) => void;
}

// Both legs of the arbitrage: buy on the cheap pool, sell on the
// expensive one. A literal eth_estimateGas on the swap would revert from
// an unfunded wallet with no allowance, so the per-swap gas comes from
// QuoterV2 (which executes the swap in a revert-simulation) plus the
// intrinsic transaction gas. Router overhead beyond that is one of the
// things the safety multiplier covers.
export async function estimateRoundTripGasUsd(
  params: RoundTripGasParams,
  deps: GasEstimateDeps = defaultGasEstimateDeps
): Promise<GasEstimate> {
  try {
    const target = await deps.getTargetToken(params.cheapPool.address, params.stablecoin);
    const buyAmountIn = parseUnits(params.tradeSizeUsd.toFixed(6), 18); // BSC USDT: 18 decimals
    const sellAmountIn = parseUnits(
      (params.tradeSizeUsd / params.expensivePool.priceUsd).toFixed(target.decimals),
      target.decimals
    );

    const [buyGas, sellGas, gasPriceWei, bnbUsd] = await Promise.all([
      deps.quoteGas({ tokenIn: params.stablecoin, tokenOut: target.address, amountIn: buyAmountIn, feeUnits: params.cheapPool.feeUnits }),
      deps.quoteGas({ tokenIn: target.address, tokenOut: params.stablecoin, amountIn: sellAmountIn, feeUnits: params.expensivePool.feeUnits }),
      deps.getGasPriceWei(),
      deps.getBnbUsd(),
    ]);

    const gasUnits = buyGas + INTRINSIC_TX_GAS + sellGas + INTRINSIC_TX_GAS;
    const costBnb = Number(gasUnits * gasPriceWei) / 1e18;
    const gasCostUsd = costBnb * bnbUsd * params.safetyMultiplier;
    if (!Number.isFinite(gasCostUsd) || gasCostUsd <= 0) {
      throw new Error(`live estimate produced an unusable value: ${gasCostUsd}`);
    }
    return { gasCostUsd, source: "live" };
  } catch (err) {
    const error = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    deps.warn(`live gas estimate failed (${error}); using fallback $${params.fallbackGasCostUsd}`);
    return { gasCostUsd: params.fallbackGasCostUsd, source: "fallback", error };
  }
}

interface BnbPoolCache {
  pool: Address | null;
  wbnb: Address | null;
  price: { at: number; value: number } | null;
}
const BNB_CACHE_KEY = Symbol.for("basis.gasEstimate.bnbCache");
function bnbCache(): BnbPoolCache {
  const g = globalThis as unknown as Record<symbol, BnbPoolCache | undefined>;
  return (g[BNB_CACHE_KEY] ??= { pool: null, wbnb: null, price: null });
}

const BNB_PRICE_TTL_MS = 60_000;
const BSC_USDT: Address = "0x55d398326f99059fF775485246999027B3197955";

// BNB/USD from the deepest PancakeSwap V3 WBNB/USDT pool, all found
// on-chain from the verified router. The pool choice is cached per
// process; the price for 60s.
export async function getBnbUsdOnChain(): Promise<number> {
  const cache = bnbCache();
  if (cache.price && Date.now() - cache.price.at < BNB_PRICE_TTL_MS) return cache.price.value;

  const client = getPublicClient();
  if (!cache.pool || !cache.wbnb) {
    const [factory, wbnb] = await Promise.all([
      client.readContract({ address: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS, abi: ROUTER_IMMUTABLES_ABI, functionName: "factory" }),
      client.readContract({ address: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS, abi: ROUTER_IMMUTABLES_ABI, functionName: "WETH9" }),
    ]);
    const candidates = await Promise.all(
      V3_FEE_TIERS.map(async (fee) => {
        const pool = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPool", args: [wbnb, BSC_USDT, fee] });
        if (/^0x0{40}$/i.test(pool)) return null;
        const liquidity = await client.readContract({ address: pool, abi: PANCAKE_V3_POOL_ABI, functionName: "liquidity" });
        return { pool, liquidity };
      })
    );
    const deepest = candidates
      .filter((c): c is { pool: Address; liquidity: bigint } => c !== null)
      .sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0))[0];
    if (!deepest) throw new Error("no PancakeSwap V3 WBNB/USDT pool found");
    cache.pool = deepest.pool;
    cache.wbnb = wbnb;
  }

  const [slot0, token0] = await Promise.all([
    client.readContract({ address: cache.pool, abi: PANCAKE_V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: cache.pool, abi: PANCAKE_V3_POOL_ABI, functionName: "token0" }),
  ]);
  // Both tokens have 18 decimals on BSC (checked on-chain 2026-09-24).
  const token1PerToken0 = sqrtPriceX96ToToken1PerToken0(slot0[0], 18, 18);
  const value = token0.toLowerCase() === BSC_USDT.toLowerCase() ? 1 / token1PerToken0 : token1PerToken0;
  cache.price = { at: Date.now(), value };
  return value;
}

const targetTokenCache = new Map<string, { address: Address; decimals: number }>();

async function getTargetTokenOnChain(poolAddress: string, stablecoin: Address): Promise<{ address: Address; decimals: number }> {
  const key = poolAddress.toLowerCase();
  const cached = targetTokenCache.get(key);
  if (cached) return cached;
  const client = getPublicClient();
  const [token0, token1] = await Promise.all([
    client.readContract({ address: poolAddress as Address, abi: PANCAKE_V3_POOL_ABI, functionName: "token0" }),
    client.readContract({ address: poolAddress as Address, abi: PANCAKE_V3_POOL_ABI, functionName: "token1" }),
  ]);
  const address = token0.toLowerCase() === stablecoin.toLowerCase() ? token1 : token0;
  const result = { address, decimals: await getErc20Decimals(address) };
  targetTokenCache.set(key, result);
  return result;
}

export const defaultGasEstimateDeps: GasEstimateDeps = {
  quoteGas: async (p) => (await simulateSwapOutput(p)).gasEstimate,
  getGasPriceWei: () => getPublicClient().getGasPrice(),
  getBnbUsd: getBnbUsdOnChain,
  getTargetToken: getTargetTokenOnChain,
  warn: (message) => console.warn(`[basis:gas] ${message}`),
};
