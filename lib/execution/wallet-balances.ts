import { formatUnits, type Address } from "viem";
import { getErc20Balance, getPublicClient } from "../data/pancakeswap-v3";
import { getTargetTokenOnChain } from "../data/gas-estimate";
import { getPoolsForTicker } from "../data/pool-addresses";
import { BSC_USDT_ADDRESS } from "../data/quotes";
import { getTradingWalletAddress } from "./agentic-wallet";

// The trading wallet's on-chain balances, for /api/status: BNB (gas),
// USDT, and MSFTB — the token the execution test buys and sells, so a
// balance left behind by a failed sell leg is visible. Public data only;
// works in PUBLIC_READ_ONLY mode (the address comes from
// TRADING_WALLET_ADDRESS there). Decimal strings, never floats.

export type WalletBalances =
  | { status: "ok"; address: string; bnb: string; usdt: string; msftb: string; msftbToken: string; blockNumber: string; readAt: string }
  | { status: "unavailable"; reason: string; readAt: string };

export interface WalletBalanceDeps {
  getAddress: () => string;
  resolveMsftb: () => Promise<{ address: Address; decimals: number }>;
  getErc20Balance: (token: Address, owner: Address) => Promise<bigint>;
  getNativeBalance: (owner: Address) => Promise<bigint>;
  getBlockNumber: () => Promise<bigint>;
  now: () => number;
}

const msftbPool = () => getPoolsForTicker("MSFT").find((p) => p.feeUnits === 2500)!.address;

const defaultDeps: WalletBalanceDeps = {
  getAddress: getTradingWalletAddress,
  resolveMsftb: () => getTargetTokenOnChain(msftbPool(), BSC_USDT_ADDRESS),
  getErc20Balance,
  getNativeBalance: (owner) => getPublicClient().getBalance({ address: owner }),
  getBlockNumber: () => getPublicClient().getBlockNumber(),
  now: Date.now,
};

// The header polls /api/status every 5 s; balances are reused for 15 s.
// Failures are not cached.
export const WALLET_BALANCES_TTL_MS = 15_000;
const CACHE_KEY = Symbol.for("basis.walletBalances.cache");
type Cache = { at: number; value: WalletBalances } | null;
const cacheHolder = globalThis as unknown as Record<symbol, Cache | undefined>;

export function resetWalletBalanceCache(): void {
  cacheHolder[CACHE_KEY] = null;
}

export async function readWalletBalances(deps: WalletBalanceDeps = defaultDeps): Promise<WalletBalances> {
  const cached = cacheHolder[CACHE_KEY];
  if (cached && deps.now() - cached.at < WALLET_BALANCES_TTL_MS) return cached.value;

  const readAt = new Date(deps.now()).toISOString();
  try {
    const address = deps.getAddress() as Address;
    const msftb = await deps.resolveMsftb();
    const blockNumber = await deps.getBlockNumber();
    const [bnb, usdt, msftbBalance] = await Promise.all([
      deps.getNativeBalance(address),
      deps.getErc20Balance(BSC_USDT_ADDRESS, address),
      deps.getErc20Balance(msftb.address, address),
    ]);
    const value: WalletBalances = {
      status: "ok",
      address,
      bnb: formatUnits(bnb, 18),
      usdt: formatUnits(usdt, 18), // BSC USDT: 18 decimals
      msftb: formatUnits(msftbBalance, msftb.decimals),
      msftbToken: msftb.address,
      blockNumber: blockNumber.toString(),
      readAt,
    };
    cacheHolder[CACHE_KEY] = { at: deps.now(), value };
    return value;
  } catch (err) {
    return { status: "unavailable", reason: err instanceof Error ? err.message.split("\n")[0]! : String(err), readAt };
  }
}
