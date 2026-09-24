import { createPublicClient, http, encodeFunctionData, type Address } from "viem";
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

// PancakeSwap V3's pure single-pool SwapRouter — deliberately NOT the
// "Smart Router" (0x13f4EA83D0bd40E75C8222255bc855a974568Dd4), which does
// its own routing across v2/v3/stable pools and would reintroduce
// exactly the auto-routing-erases-the-gap problem this whole direct-pool
// path exists to bypass. Confirmed two ways: (1) developer.pancakeswap.finance/
// contracts/v3/addresses labels this address "SwapRouter (v3)", separate
// from "Smart Router"; (2) the verified ABI (below) was pulled directly
// from Sourcify (sourcify.dev), chain 56, this exact address — not a
// docs paraphrase — confirming `internalType: "struct ISwapRouter.ExactInputSingleParams"`,
// a pure-V3 interface with no aggregation logic.
export const PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS: Address = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";

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

// Standard ERC-20 allowance()/approve() — not PancakeSwap-specific, the
// same two functions on every compliant token contract. No research risk
// here the way the SwapRouter struct had: this is the most conventional
// possible ABI shape.
export const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Conventional sentinel address (used by several DEX routers/aggregators,
// e.g. 1inch/Paraswap) to mean "native BNB" in a tokenIn/tokenOut slot —
// it is not itself an ERC-20 contract, so allowance()/approve() are
// meaningless against it. Nothing in this codebase currently produces a
// native-BNB leg (both registered MSFTB pools are ERC-20/ERC-20), but
// checkAllowance() below guards for it explicitly rather than letting a
// future native leg silently attempt a contract call against a
// non-contract address.
export const NATIVE_TOKEN_SENTINEL: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export async function getErc20Decimals(tokenAddress: Address): Promise<number> {
  const client = getPublicClient();
  return client.readContract({ address: tokenAddress, abi: ERC20_DECIMALS_ABI, functionName: "decimals" });
}

export interface AllowanceCheckResult {
  sufficient: boolean;
  currentAllowance: bigint;
  // Present only when sufficient is false — an unsigned approve() tx to
  // sign and send before the swap itself.
  approveTransaction?: UnsignedTransaction;
}

// Replaces the old Binance-aggregator-based approvalCheck() for the
// direct-pool execution path: reads the real on-chain allowance the
// trading wallet has granted to spenderAddress (PancakeSwap V3's
// SwapRouter, in practice) and builds a real approve() transaction if
// it's insufficient. No guessed response shape — this is a plain
// eth_call read plus locally-encoded calldata, not a third-party API
// response format.
export async function checkAllowance(params: {
  tokenAddress: Address;
  ownerAddress: Address;
  spenderAddress: Address;
  amountRequired: bigint;
}): Promise<AllowanceCheckResult> {
  if (params.tokenAddress.toLowerCase() === NATIVE_TOKEN_SENTINEL.toLowerCase()) {
    return { sufficient: true, currentAllowance: 0n };
  }

  const client = getPublicClient();
  const currentAllowance = await client.readContract({
    address: params.tokenAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [params.ownerAddress, params.spenderAddress],
  });

  if (currentAllowance >= params.amountRequired) {
    return { sufficient: true, currentAllowance };
  }

  const data = encodeFunctionData({
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "approve",
    args: [params.spenderAddress, params.amountRequired],
  });

  return { sufficient: false, currentAllowance, approveTransaction: { to: params.tokenAddress, data } };
}

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

// Verified directly from Sourcify (sourcify.dev/server/v2/contract/56/0x1b81D678ffb9C0263b24A97847620C99d213eB14),
// NOT from a docs page (an earlier version of this plan cited a docs
// summary that omitted `deadline` entirely — an 8-field struct read as
// 7 fields, which would have encoded "successfully" and only failed at
// broadcast time). This is the literal verified ABI entry.
export const V3_SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
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

// Deliberately structurally identical to lib/execution/agentic-wallet.ts's
// own UnsignedTransaction, not imported from it — this is the data
// layer, agentic-wallet.ts is the execution layer that depends on it, so
// importing agentic-wallet.ts's type here would invert that dependency
// (and risk a real circular import, since agentic-wallet.ts is the one
// that will import buildExactInputSingleTransaction from this file).
// TypeScript's structural typing makes the two interchangeable without
// any explicit conversion.
export interface UnsignedTransaction {
  to: string;
  data: string;
  value?: string;
}

// Encodes a direct, single-pool PancakeSwap V3 swap via the pure
// SwapRouter (PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS above) — never the
// aggregating Smart Router. Read-only encoding, no network call: the
// resulting UnsignedTransaction plugs into lib/execution/agentic-wallet.ts's
// existing send() (sign locally via viem, broadcast via BSC_RPC_URL)
// unchanged — this function only builds calldata.
//
// `deadlineSecondsFromNow` is injectable (defaults to 600s / 10 minutes,
// a conventional DEX default) so tests can assert against a fixed
// deadline rather than a moving `Date.now()`.
export function buildExactInputSingleTransaction(params: {
  tokenIn: Address;
  tokenOut: Address;
  feeUnits: number;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadlineSecondsFromNow?: number;
  now?: () => number;
}): UnsignedTransaction {
  const now = params.now ?? Date.now;
  const deadline = BigInt(Math.floor(now() / 1000) + (params.deadlineSecondsFromNow ?? 600));

  const data = encodeFunctionData({
    abi: V3_SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.feeUnits,
        recipient: params.recipient,
        deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return { to: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS, data };
}
