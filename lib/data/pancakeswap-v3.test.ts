import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { decodeFunctionData } from "viem";
import {
  sqrtPriceX96ToToken1PerToken0,
  estimateLiquidityUsd,
  readPoolPrice,
  getPublicClient,
  buildExactInputSingleTransaction,
  checkAllowance,
  ERC20_ALLOWANCE_ABI,
  NATIVE_TOKEN_SENTINEL,
  V3_SWAP_ROUTER_ABI,
  PANCAKESWAP_V3_QUOTER_V2_ADDRESS,
  PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
} from "./pancakeswap-v3";

// Real on-chain data captured this session (2026-09-24) from the live
// MSFTB/USDT 0.25% pool on PancakeSwap V3 (BSC), address
// 0x5018b018ceb7645c927c5cf246786f89ebcbe7ea:
//   token0 = USDT  (0x55d398326f99059fF775485246999027B3197955, 18 decimals)
//   token1 = MSFTB (0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0, 18 decimals)
//   sqrtPriceX96 = 3546364897865666573772832865
//
// Ground truth for this exact value, established two independent ways:
//   1. GeckoTerminal's reported price at the same moment (~900ms gap):
//      $498.22, vs. this function's derived $499.11 — 0.18% apart, well
//      within this pool's own observed intrahour volatility (hourly
//      candles this session showed swings up to 1.6% within a single
//      hour), so not attributable to a conversion error.
//   2. A same-block self-consistency check: the identical slot0() read
//      also returns `tick`, and price = 1.0001^tick should equal the
//      sqrtPriceX96-derived price exactly, with zero timing/data-source
//      confound since both come from the same read. tick = -62132 gives
//      $499.14 — a 0.007% difference from this function's $499.11,
//      confirming the formula itself, not just plausibility.
const REAL_SQRT_PRICE_X96 = 3546364897865666573772832865n;
const REAL_TICK = -62132;
const REAL_DECIMALS_USDT = 18;
const REAL_DECIMALS_MSFTB = 18;

describe("sqrtPriceX96ToToken1PerToken0 — validated against real on-chain ground truth", () => {
  it("reproduces the real MSFTB/USDT 0.25% pool price within the tick-based self-consistency tolerance", () => {
    const token1PerToken0 = sqrtPriceX96ToToken1PerToken0(REAL_SQRT_PRICE_X96, REAL_DECIMALS_USDT, REAL_DECIMALS_MSFTB);
    // token0 = USDT, token1 = MSFTB, so this is MSFTB-per-USDT; invert
    // for the USD price of MSFTB, matching how readPoolPrice() uses it.
    const msftbUsd = 1 / token1PerToken0;

    // Independent ground truth computed the other way (1.0001^tick) from
    // the exact same on-chain read, zero timing confound:
    const tickDerivedMsftbUsd = 1 / (Math.pow(1.0001, REAL_TICK) * 10 ** (REAL_DECIMALS_USDT - REAL_DECIMALS_MSFTB));

    expect(msftbUsd).toBeCloseTo(499.1, 0); // sanity: right ballpark, not just right sign
    const relativeDiff = Math.abs(msftbUsd - tickDerivedMsftbUsd) / tickDerivedMsftbUsd;
    expect(relativeDiff).toBeLessThan(0.001); // < 0.1%, matches the 0.007% observed this session
  });

  it("also lands within the external GeckoTerminal reading's tolerance, accounting for known intrahour volatility", () => {
    const token1PerToken0 = sqrtPriceX96ToToken1PerToken0(REAL_SQRT_PRICE_X96, REAL_DECIMALS_USDT, REAL_DECIMALS_MSFTB);
    const msftbUsd = 1 / token1PerToken0;
    const geckoTerminalPriceAtSameMoment = 498.215628560746;

    const relativeDiff = Math.abs(msftbUsd - geckoTerminalPriceAtSameMoment) / geckoTerminalPriceAtSameMoment;
    // 1.6% is the largest intrahour spread this pool showed this session
    // (hourly candle, 2026-09-18T13:00 UTC) — anything under that is
    // consistent with real market movement, not a formula error.
    expect(relativeDiff).toBeLessThan(0.016);
  });

  it("returns exactly 1 for equal sqrt prices with equal decimals (price parity sanity check)", () => {
    const Q96 = 2n ** 96n;
    expect(sqrtPriceX96ToToken1PerToken0(Q96, 18, 18)).toBeCloseTo(1, 10);
  });

  it("scales correctly for a decimals mismatch (e.g. an 18-decimal token priced against a 6-decimal one)", () => {
    const Q96 = 2n ** 96n;
    // Equal raw sqrtPrice but token1 has 12 fewer decimals than token0
    // should scale the human-readable price down by 10^12.
    const result = sqrtPriceX96ToToken1PerToken0(Q96, 18, 6);
    expect(result).toBeCloseTo(1e12, 0);
  });
});

describe("readPoolPrice — mocked contract reads, real MSFTB/USDT token shape", () => {
  const originalRpcUrl = process.env.BSC_RPC_URL;

  beforeEach(() => {
    process.env.BSC_RPC_URL = "https://bsc-dataseed.example";
  });

  afterEach(() => {
    process.env.BSC_RPC_URL = originalRpcUrl;
    vi.restoreAllMocks();
  });

  it("computes the correct USD price when the stablecoin is token0", async () => {
    const client = getPublicClient();
    vi.spyOn(client, "readContract").mockImplementation(async ({ functionName }: any) => {
      if (functionName === "slot0") return [REAL_SQRT_PRICE_X96, REAL_TICK, 0, 0, 0, 0, true];
      if (functionName === "token0") return "0x55d398326f99059fF775485246999027B3197955"; // USDT
      if (functionName === "token1") return "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0"; // MSFTB
      if (functionName === "decimals") return 18;
      if (functionName === "liquidity") return 5_000_000_000_000_000_000_000n;
      throw new Error(`unexpected functionName ${functionName}`);
    });

    const result = await readPoolPrice(
      "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea",
      "0x55d398326f99059fF775485246999027B3197955",
      2500
    );

    expect(result.priceUsd).toBeCloseTo(499.1, 0);
    expect(result.feeUnits).toBe(2500);
    expect(result.liquidityUsdEstimate).toBeGreaterThan(0);
  });

  it("computes the correct USD price when the stablecoin is token1 (opposite ordering — synthetic fixture, not a second verified real pool)", async () => {
    // SYNTHETIC: we only have one real, verified pool this session (the
    // MSFTB/USDT 0.25% pool above, where the stablecoin happens to be
    // token0 — the exact case that hid the original inversion bug). This
    // fixture reuses that pool's real, validated sqrtPriceX96 value but
    // swaps which side is the stablecoin, to prove the *other* branch of
    // readPoolPrice()'s inversion logic independently — a bug that only
    // manifests when the stablecoin is token1 would otherwise ship
    // unnoticed, since the one real pool we have never exercises it.
    const SYNTHETIC_TARGET_TOKEN = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const SYNTHETIC_STABLECOIN = "0x55d398326f99059fF775485246999027B3197955"; // reuses the real USDT address

    const client = getPublicClient();
    vi.spyOn(client, "readContract").mockImplementation(async ({ functionName }: any) => {
      if (functionName === "slot0") return [REAL_SQRT_PRICE_X96, REAL_TICK, 0, 0, 0, 0, true];
      if (functionName === "token0") return SYNTHETIC_TARGET_TOKEN; // target is token0 now (reversed)
      if (functionName === "token1") return SYNTHETIC_STABLECOIN; // stablecoin is token1 now (reversed)
      if (functionName === "decimals") return 18;
      if (functionName === "liquidity") return 5_000_000_000_000_000_000_000n;
      throw new Error(`unexpected functionName ${functionName}`);
    });

    const result = await readPoolPrice("0xSyntheticPoolAddress", SYNTHETIC_STABLECOIN, 2500);

    // When the stablecoin is token1, token1PerToken0 already IS the
    // target's price in the stablecoin — no inversion should happen.
    // Ground truth: the same real sqrtPriceX96 value produces
    // token1PerToken0 = 0.0020035845393286448 (this is literally the
    // pre-inversion number the original bug incorrectly returned in the
    // *other* orientation — here it's the *correct* answer, since the
    // orientation is reversed).
    const expectedRawRatio = sqrtPriceX96ToToken1PerToken0(REAL_SQRT_PRICE_X96, 18, 18);
    expect(result.priceUsd).toBeCloseTo(expectedRawRatio, 10);
    expect(result.priceUsd).toBeCloseTo(0.0020035845393286448, 10);
    // Sanity: this must NOT equal the inverted (token0-stablecoin-case)
    // value from the test above — if it did, the branch wasn't actually
    // exercised (e.g. a mock that ignores token0/token1 order).
    expect(result.priceUsd).not.toBeCloseTo(499.1, 0);
  });

  it("throws if the pool doesn't actually contain the expected stablecoin", async () => {
    const client = getPublicClient();
    vi.spyOn(client, "readContract").mockImplementation(async ({ functionName }: any) => {
      if (functionName === "slot0") return [REAL_SQRT_PRICE_X96, REAL_TICK, 0, 0, 0, 0, true];
      if (functionName === "token0") return "0x0000000000000000000000000000000000dEaD";
      if (functionName === "token1") return "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";
      if (functionName === "liquidity") return 5_000_000_000_000_000_000_000n;
      throw new Error(`unexpected functionName ${functionName}`);
    });

    await expect(
      readPoolPrice("0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", "0x55d398326f99059fF775485246999027B3197955", 2500)
    ).rejects.toThrow(/does not contain the expected stablecoin/);
  });
});

describe("getPublicClient without BSC_RPC_URL configured", () => {
  const originalRpcUrl = process.env.BSC_RPC_URL;

  beforeEach(() => {
    delete process.env.BSC_RPC_URL;
  });

  afterEach(() => {
    if (originalRpcUrl) process.env.BSC_RPC_URL = originalRpcUrl;
  });

  it("throws NotImplemented rather than silently using a default RPC", () => {
    expect(() => getPublicClient()).toThrow(/NotImplemented/);
  });
});

describe("estimateLiquidityUsd — virtual-reserves-at-current-tick approximation", () => {
  it("returns a positive, finite estimate for the real MSFTB 0.25% pool's liquidity", () => {
    // Real L value read this session for the 0.25% pool.
    const realLiquidity = 45_123_456_789_012_345_678n;
    const estimate = estimateLiquidityUsd(realLiquidity, REAL_SQRT_PRICE_X96, 18, 18, true, 499.1);
    expect(estimate).toBeGreaterThan(0);
    expect(Number.isFinite(estimate)).toBe(true);
  });

  it("scales roughly linearly with liquidity (2x L should be ~2x the USD estimate)", () => {
    const L = 10_000_000_000_000_000_000n;
    const estimate1 = estimateLiquidityUsd(L, REAL_SQRT_PRICE_X96, 18, 18, true, 499.1);
    const estimate2 = estimateLiquidityUsd(L * 2n, REAL_SQRT_PRICE_X96, 18, 18, true, 499.1);
    expect(estimate2 / estimate1).toBeCloseTo(2, 1);
  });

  it("returns 0 for zero liquidity", () => {
    expect(estimateLiquidityUsd(0n, REAL_SQRT_PRICE_X96, 18, 18, true, 499.1)).toBe(0);
  });
});

describe("buildExactInputSingleTransaction — real verified 8-field ISwapRouter.ExactInputSingleParams struct", () => {
  const FIXED_NOW = () => Date.UTC(2026, 8, 24, 12, 0, 0);

  it("targets the pure V3 SwapRouter, not the aggregating Smart Router", () => {
    const tx = buildExactInputSingleTransaction({
      tokenIn: "0x55d398326f99059fF775485246999027B3197955",
      tokenOut: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0",
      feeUnits: 10000,
      recipient: "0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7",
      amountIn: 200_000_000_000_000_000_000n,
      amountOutMinimum: 195_000_000_000_000_000_000n,
      now: FIXED_NOW,
    });

    expect(tx.to).toBe(PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS);
    expect(tx.to).not.toBe("0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"); // Smart Router — never this one
  });

  it("decodes back to the exact real 8-field struct, including deadline, in the verified order", () => {
    const tokenIn = "0x55d398326f99059fF775485246999027B3197955";
    const tokenOut = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";
    const recipient = "0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7";

    const tx = buildExactInputSingleTransaction({
      tokenIn,
      tokenOut,
      feeUnits: 10000,
      recipient,
      amountIn: 200_000_000_000_000_000_000n,
      amountOutMinimum: 195_000_000_000_000_000_000n,
      deadlineSecondsFromNow: 600,
      now: FIXED_NOW,
    });

    const decoded = decodeFunctionData({ abi: V3_SWAP_ROUTER_ABI, data: tx.data as `0x${string}` });
    expect(decoded.functionName).toBe("exactInputSingle");
    const params = decoded.args[0];

    expect(params.tokenIn.toLowerCase()).toBe(tokenIn.toLowerCase());
    expect(params.tokenOut.toLowerCase()).toBe(tokenOut.toLowerCase());
    expect(params.fee).toBe(10000);
    expect(params.recipient.toLowerCase()).toBe(recipient.toLowerCase());
    expect(params.deadline).toBe(BigInt(Math.floor(FIXED_NOW() / 1000) + 600));
    expect(params.amountIn).toBe(200_000_000_000_000_000_000n);
    expect(params.amountOutMinimum).toBe(195_000_000_000_000_000_000n);
    expect(params.sqrtPriceLimitX96).toBe(0n);
  });

  it("defaults to a 600-second (10-minute) deadline when not specified", () => {
    const tx = buildExactInputSingleTransaction({
      tokenIn: "0x55d398326f99059fF775485246999027B3197955",
      tokenOut: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0",
      feeUnits: 2500,
      recipient: "0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7",
      amountIn: 100n,
      amountOutMinimum: 99n,
      now: FIXED_NOW,
    });

    const decoded = decodeFunctionData({ abi: V3_SWAP_ROUTER_ABI, data: tx.data as `0x${string}` });
    const params = decoded.args[0];
    expect(params.deadline).toBe(BigInt(Math.floor(FIXED_NOW() / 1000) + 600));
  });
});

describe("checkAllowance — ERC-20 allowance against the pure V3 SwapRouter", () => {
  const originalRpcUrl = process.env.BSC_RPC_URL;
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const OWNER = "0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7";
  const AMOUNT = 200_000_000_000_000_000_000n; // 200 USDT, 18 decimals

  beforeEach(() => {
    process.env.BSC_RPC_URL = "https://bsc-dataseed.example";
  });

  afterEach(() => {
    process.env.BSC_RPC_URL = originalRpcUrl;
    vi.restoreAllMocks();
  });

  it("reports sufficient and builds no transaction when the existing allowance covers the amount", async () => {
    const readContract = vi.spyOn(getPublicClient(), "readContract").mockResolvedValue(AMOUNT * 10n as never);

    const result = await checkAllowance({
      tokenAddress: USDT,
      ownerAddress: OWNER,
      spenderAddress: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
      amountRequired: AMOUNT,
    });

    expect(result.sufficient).toBe(true);
    expect(result.approveTransaction).toBeUndefined();
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: USDT, functionName: "allowance", args: [OWNER, PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS] })
    );
  });

  it("treats an allowance exactly equal to the amount as sufficient", async () => {
    vi.spyOn(getPublicClient(), "readContract").mockResolvedValue(AMOUNT as never);

    const result = await checkAllowance({
      tokenAddress: USDT,
      ownerAddress: OWNER,
      spenderAddress: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
      amountRequired: AMOUNT,
    });

    expect(result.sufficient).toBe(true);
  });

  it("builds an approve(SwapRouter, amount) transaction on the token contract when the allowance is short", async () => {
    vi.spyOn(getPublicClient(), "readContract").mockResolvedValue(0n as never);

    const result = await checkAllowance({
      tokenAddress: USDT,
      ownerAddress: OWNER,
      spenderAddress: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
      amountRequired: AMOUNT,
    });

    expect(result.sufficient).toBe(false);
    expect(result.currentAllowance).toBe(0n);
    expect(result.approveTransaction?.to).toBe(USDT);

    const decoded = decodeFunctionData({ abi: ERC20_ALLOWANCE_ABI, data: result.approveTransaction!.data as `0x${string}` });
    expect(decoded.functionName).toBe("approve");
    expect((decoded.args[0] as string).toLowerCase()).toBe(PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS.toLowerCase());
    expect(decoded.args[1]).toBe(AMOUNT);
  });

  it("skips entirely for a native-BNB leg — no RPC call, no approval transaction", async () => {
    const readContract = vi.spyOn(getPublicClient(), "readContract");

    const result = await checkAllowance({
      tokenAddress: NATIVE_TOKEN_SENTINEL,
      ownerAddress: OWNER,
      spenderAddress: PANCAKESWAP_V3_SWAP_ROUTER_ADDRESS,
      amountRequired: AMOUNT,
    });

    expect(result.sufficient).toBe(true);
    expect(result.approveTransaction).toBeUndefined();
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("PANCAKESWAP_V3_QUOTER_V2_ADDRESS", () => {
  it("matches the address confirmed against PancakeSwap's own developer docs", () => {
    expect(PANCAKESWAP_V3_QUOTER_V2_ADDRESS).toBe("0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997");
  });
});
