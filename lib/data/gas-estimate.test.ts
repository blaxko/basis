import { describe, it, expect, vi } from "vitest";
import { estimateRoundTripGasUsd, type GasEstimateDeps, type RoundTripGasParams } from "./gas-estimate";

const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" as const;

const PARAMS: RoundTripGasParams = {
  stablecoin: USDT,
  cheapPool: { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 497.2197 },
  expensivePool: { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: 497.9 },
  tradeSizeUsd: 200,
  safetyMultiplier: 2,
  fallbackGasCostUsd: 0.21,
};

// Figures from the 2026-09-24 live read (block 123812097): QuoterV2 gas
// 167,237 (0.25% pool buy) and 138,091 (1% pool buy), 0.05 gwei, BNB
// ~$777 on-chain.
function deps(overrides: Partial<GasEstimateDeps> = {}): GasEstimateDeps {
  return {
    quoteGas: vi.fn(async ({ feeUnits }) => (feeUnits === 2500 ? 167_237n : 138_091n)),
    getGasPriceWei: vi.fn(async () => 50_000_000n),
    getBnbUsd: vi.fn(async () => 777.19),
    getTargetToken: vi.fn(async () => ({ address: MSFTB, decimals: 18 })),
    warn: vi.fn(),
    ...overrides,
  };
}

describe("estimateRoundTripGasUsd", () => {
  it("prices both legs plus intrinsic gas at the live gas price and BNB price, times the safety multiplier", async () => {
    const d = deps();
    const result = await estimateRoundTripGasUsd(PARAMS, d);

    const gasUnits = 167_237 + 21_000 + 138_091 + 21_000;
    const expected = ((gasUnits * 50_000_000) / 1e18) * 777.19 * 2;
    expect(result.source).toBe("live");
    expect(result.gasCostUsd).toBeCloseTo(expected, 10);
    expect(result.gasCostUsd).toBeCloseTo(0.027, 3); // ~8x below the old flat $0.21, even with the 2x multiplier
    expect(d.warn).not.toHaveBeenCalled();
  });

  it("quotes the buy on the cheap pool (USDT in) and the sell on the expensive pool (target token in)", async () => {
    const d = deps();
    await estimateRoundTripGasUsd(PARAMS, d);

    expect(d.quoteGas).toHaveBeenCalledWith(expect.objectContaining({ tokenIn: USDT, tokenOut: MSFTB, feeUnits: 2500 }));
    expect(d.quoteGas).toHaveBeenCalledWith(expect.objectContaining({ tokenIn: MSFTB, tokenOut: USDT, feeUnits: 10000 }));
  });

  it("falls back to the flat figure and logs it when any live read fails", async () => {
    const d = deps({ getGasPriceWei: vi.fn(async () => Promise.reject(new Error("RPC timed out"))) });
    const result = await estimateRoundTripGasUsd(PARAMS, d);

    expect(result).toEqual({ gasCostUsd: 0.21, source: "fallback", error: "RPC timed out" });
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining("using fallback $0.21"));
  });

  it("falls back rather than returning a zero or non-finite cost", async () => {
    const d = deps({ getBnbUsd: vi.fn(async () => Number.NaN) });
    const result = await estimateRoundTripGasUsd(PARAMS, d);

    expect(result.source).toBe("fallback");
    expect(result.gasCostUsd).toBe(0.21);
  });
});
