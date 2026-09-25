import { getAddress, isAddress } from "viem";

// PUBLIC_READ_ONLY is the mode for a publicly reachable deployment. In it:
//   - the trading key is never read (TRADING_WALLET_ADDRESS stands in for
//     the address that simulations, allowance reads and quotes need);
//   - the killswitch can't be set to "live", and send() refuses;
//   - /api/execution-test answers 403 without loading the send path;
//   - routes that trigger Binance or Groq calls are rate-limited per IP.
//
// Parsed fail-closed: unset, "" or "false" is the normal mode, "true" is
// read-only, and any other value (a typo such as "True" or "yes") is also
// read-only, so a misspelling on a public host can't unlock sending.
export function isPublicReadOnly(): boolean {
  const raw = process.env.PUBLIC_READ_ONLY;
  if (raw === undefined) return false;
  const value = raw.trim();
  return !(value === "" || value === "false");
}

// The trading wallet's public address in read-only mode. Checksummed.
export function getReadOnlyWalletAddress(): `0x${string}` {
  const raw = process.env.TRADING_WALLET_ADDRESS?.trim();
  if (!raw) {
    throw new Error("PUBLIC_READ_ONLY: TRADING_WALLET_ADDRESS is not set (the private key is never read in read-only mode).");
  }
  if (!isAddress(raw, { strict: false })) {
    throw new Error("PUBLIC_READ_ONLY: TRADING_WALLET_ADDRESS is not a valid address.");
  }
  return getAddress(raw);
}

export class ReadOnlyModeError extends Error {
  constructor(action: string) {
    super(`PUBLIC_READ_ONLY: ${action} is disabled on this deployment.`);
    this.name = "ReadOnlyModeError";
  }
}
