import { describe, it, expect, vi, beforeEach } from "vitest";
import { readWalletBalances, resetWalletBalanceCache, WALLET_BALANCES_TTL_MS, type WalletBalanceDeps } from "./wallet-balances";

const WALLET = "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95";
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";
const E18 = 10n ** 18n;

// SYNTHETIC: the funded state read on 2026-09-25 (0.00292984 BNB, 5 USDT)
// plus 0.004 MSFTB, as if a sell leg had failed.
function deps(overrides: Partial<WalletBalanceDeps> = {}) {
  let t = 1_000_000;
  const d = {
    getAddress: () => WALLET,
    resolveMsftb: vi.fn(async () => ({ address: MSFTB as `0x${string}`, decimals: 18 })),
    getErc20Balance: vi.fn(async (token: string) => (token === MSFTB ? (4n * E18) / 1000n : 5n * E18)),
    getNativeBalance: vi.fn(async () => 2_929_840_000_000_000n),
    getBlockNumber: vi.fn(async () => 123933693n),
    now: () => t,
    ...overrides,
  };
  return { d, advance: (ms: number) => (t += ms) };
}

describe("readWalletBalances", () => {
  beforeEach(() => resetWalletBalanceCache());

  it("reads BNB, USDT and MSFTB as decimal strings, with the block", async () => {
    const { d } = deps();
    expect(await readWalletBalances(d)).toMatchObject({
      status: "ok",
      address: WALLET,
      bnb: "0.00292984",
      usdt: "5",
      msftb: "0.004",
      msftbToken: MSFTB,
      blockNumber: "123933693",
    });
  });

  it(`reuses a read for ${WALLET_BALANCES_TTL_MS / 1000} s, then reads again`, async () => {
    const { d, advance } = deps();
    await readWalletBalances(d);
    await readWalletBalances(d);
    expect(d.getNativeBalance).toHaveBeenCalledTimes(1);
    advance(WALLET_BALANCES_TTL_MS);
    await readWalletBalances(d);
    expect(d.getNativeBalance).toHaveBeenCalledTimes(2);
  });

  it("reports a failed read as unavailable, and doesn't cache it", async () => {
    const { d } = deps({ getBlockNumber: vi.fn(async () => Promise.reject(new Error("HTTP request failed.\nURL: https://…"))) });
    expect(await readWalletBalances(d)).toMatchObject({ status: "unavailable", reason: "HTTP request failed." });
    const ok = deps();
    expect((await readWalletBalances(ok.d)).status).toBe("ok");
  });
});
