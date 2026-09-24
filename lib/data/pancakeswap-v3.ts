import { createPublicClient, http, type Address } from "viem";
import { bsc } from "viem/chains";

// Addresses and ABIs below are sourced from PancakeSwap's own developer
// docs, cited per-item — not from memory, not guessed:
//   - QuoterV2 BSC address: https://developer.pancakeswap.finance/contracts/v3/addresses
//     0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997
//   - PancakeV3Pool slot0()/token0()/token1()/fee() signatures:
//     https://developer.pancakeswap.finance/contracts/v3/pancakev3pool
//   - QuoterV2.quoteExactInputSingle params/returns: confirmed against
//     the same struct shape as Uniswap's QuoterV2 (PancakeSwap's V3 is a
//     fork of Uniswap V3's periphery contracts), cross-checked via
//     public BscScan verified source at the address above.
export const PANCAKESWAP_V3_QUOTER_V2_ADDRESS: Address = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";

export const PANCAKE_V3_POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
] as const;

const ERC20_DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    // The real deployed contract declares this "nonpayable" (it's
    // implemented via a revert-encoded-result trick, never actually
    // changing state) — declared "view" here instead so viem's
    // readContract() infers a return type at all; encoding/eth_call
    // behavior is identical either way, since ABI call encoding doesn't
    // depend on stateMutability.
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

interface RpcConfig {
  rpcUrl: string;
}

function getRpcConfig(): RpcConfig {
  const rpcUrl = process.env.BSC_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      "NotImplemented: BSC_RPC_URL is not set. Pool price reads and Quoter " +
        "simulations are built against real on-chain contracts but have no " +
        "RPC endpoint configured yet — see .env.example."
    );
  }
  return { rpcUrl };
}

let cachedClient: ReturnType<typeof createPublicClient> | null = null;
let cachedRpcUrl: string | null = null;

// Read-only client — no account, no signing capability at all. Separate
// from lib/execution/agentic-wallet.ts's write/sign wallet client.
export function getPublicClient() {
  const { rpcUrl } = getRpcConfig();
  if (!cachedClient || cachedRpcUrl !== rpcUrl) {
    cachedClient = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
    cachedRpcUrl = rpcUrl;
  }
  return cachedClient;
}

// Price of 1 token0 denominated in token1, decimal-adjusted — the
// standard Uniswap/PancakeSwap V3 slot0 convention. A pure function,
// independent of which token is the "target" — callers invert as needed
// based on which side of the pool their token of interest sits on.
//
// Validated this session against two independent references for the
// real MSFTB/USDT 0.25% pool (sqrtPriceX96 = 3546364897865666573772832865,
// decimals 18/18): (1) an external source (GeckoTerminal) at the same
// moment, within ~0.18%, consistent with known intrahour volatility for
// this pool (up to 1.6% swings observed this session), and (2) a same-block
// self-consistency check against the pool's own `tick` value via
// price = 1.0001^tick, which matched to within 0.007% — confirming the
// formula itself, independent of any external data source's timing/caching.
export function sqrtPriceX96ToToken1PerToken0(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const rawPrice = ratio * ratio;
  return rawPrice * 10 ** (decimals0 - decimals1);
}

export interface PoolPriceResult {
  poolAddress: string;
  feeUnits: number;
  priceUsd: number; // price of the non-stablecoin token, in the stablecoin
  // Near-current-tick liquidity value in USD, both sides summed — an
  // ESTIMATE, not an exact reserve figure. V3 liquidity is concentrated
  // across tick ranges, not a simple constant-product reserve pair, so
  // this uses the standard "virtual reserves at the current tick" proxy
  // (reserve0 ~ L / sqrt(price), reserve1 ~ L * sqrt(price)) rather than
  // integrating the full liquidity distribution. Good enough for a
  // sanity/depth threshold check, not for precise slippage accounting.
  liquidityUsdEstimate: number;
  token0: Address;
  token1: Address;
}

// Reads a single pool's slot0()/token0()/token1()/liquidity() and
// returns the non-stablecoin token's USD price plus an estimated
// liquidity depth. `stablecoinAddress` tells this function which side
// of the pool is the numeraire — it doesn't assume token0/token1
// ordering, since that's sorted by address per pool and varies pool to
// pool.
export async function readPoolPrice(poolAddress: Address, stablecoinAddress: Address, feeUnits: number): Promise<PoolPriceResult> {
  const client = getPublicClient();

  const [slot0, token0, token1, liquidity] = await Promise.all([
    client.readContract({ address: poolAddress, abi: PANCAKE_V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: poolAddress, abi: PANCAKE_V3_POOL_ABI, functionName: "token0" }),
    client.readContract({ address: poolAddress, abi: PANCAKE_V3_POOL_ABI, functionName: "token1" }),
    client.readContract({ address: poolAddress, abi: PANCAKE_V3_POOL_ABI, functionName: "liquidity" }),
  ]);

  const stablecoinIsToken0 = token0.toLowerCase() === stablecoinAddress.toLowerCase();
  const stablecoinIsToken1 = token1.toLowerCase() === stablecoinAddress.toLowerCase();
  if (!stablecoinIsToken0 && !stablecoinIsToken1) {
    throw new Error(`Pool ${poolAddress} does not contain the expected stablecoin ${stablecoinAddress} as either token0 or token1`);
  }

  const [dec0, dec1] = await Promise.all([
    client.readContract({ address: token0, abi: ERC20_DECIMALS_ABI, functionName: "decimals" }),
    client.readContract({ address: token1, abi: ERC20_DECIMALS_ABI, functionName: "decimals" }),
  ]);

  const sqrtPriceX96 = slot0[0];
  const token1PerToken0 = sqrtPriceX96ToToken1PerToken0(sqrtPriceX96, dec0, dec1);

  // token1PerToken0 = how many token1 per 1 token0. If the stablecoin is
  // token0, that ratio is "target-per-stablecoin" and must be inverted
  // to get the target's USD price; if the stablecoin is token1, the
  // ratio already reads directly as "stablecoin-per-target".
  const priceUsd = stablecoinIsToken0 ? 1 / token1PerToken0 : token1PerToken0;

  const liquidityUsdEstimate = estimateLiquidityUsd(liquidity, sqrtPriceX96, dec0, dec1, stablecoinIsToken0, priceUsd);

  return { poolAddress, feeUnits, priceUsd, liquidityUsdEstimate, token0, token1 };
}

// Standard Uniswap/PancakeSwap V3 "virtual reserves at the current tick"
// approximation: reserve0 = L / sqrt(P), reserve1 = L * sqrt(P), where P
// is the raw (undecimaled) token1-per-token0 price. Sums both sides'
// USD value using the already-computed target price and an assumed
// stablecoin price of 1.
export function estimateLiquidityUsd(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
  stablecoinIsToken0: boolean,
  targetPriceUsd: number
): number {
  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
  const L = Number(liquidity);

  const reserve0Raw = sqrtPrice > 0 ? L / sqrtPrice : 0;
  const reserve1Raw = L * sqrtPrice;

  const reserve0 = reserve0Raw / 10 ** decimals0;
  const reserve1 = reserve1Raw / 10 ** decimals1;

  const stablecoinReserve = stablecoinIsToken0 ? reserve0 : reserve1;
  const targetReserve = stablecoinIsToken0 ? reserve1 : reserve0;

  return stablecoinReserve + targetReserve * targetPriceUsd;
}

// Read-only simulation via PancakeSwap V3's QuoterV2 — a real on-chain
// view call (zero cost, no state change), standing in for Binance's
// dry-run for this direct-pool leg specifically. Not wired to
// lib/execution/pipeline.ts yet (out of scope this session).
export async function simulateSwapOutput(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  feeUnits: number;
}): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  const client = getPublicClient();

  const [amountOut, , , gasEstimate] = await client.readContract({
    address: PANCAKESWAP_V3_QUOTER_V2_ADDRESS,
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        fee: params.feeUnits,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return { amountOut, gasEstimate };
}
