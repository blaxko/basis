import { createHmac } from "node:crypto";
import { createPublicClient, createWalletClient, http } from "viem";
import {
  simulateEvmTransaction,
  broadcastWithMevProtection,
  type EvmTxToSimulate,
  type TxSimulation,
  type BroadcastResult,
} from "../data/binance-transaction";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

// Real request shape for Binance Web3 Transaction API's DEX aggregator,
// confirmed via portal reference (not a guess): a single GET call to
// quote-and-swap, no separate quote step. "vendor" currently only
// supports "LiquidMesh". Either slippagePercent or autoSlippage=true is
// required — autoSlippage lets the aggregator pick it.
export interface SwapRequest {
  binanceChainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string; // fromToken amount, in the token's base units
  userWalletAddress: string;
  vendor: string;
  slippagePercent?: string;
  autoSlippage?: boolean;
}

// Confirmed via portal reference: the unsigned transaction is at
// `data.tx`, not `data.transaction` (an earlier, unverified guess).
export interface UnsignedTransaction {
  to: string;
  data: string;
  value?: string;
}

export interface DryRunResult {
  outputUsd: number;
  unsignedTransaction: UnsignedTransaction;
  raw: unknown;
}

export interface ApprovalCheckResult {
  needsApproval: boolean;
  approvalTransaction?: UnsignedTransaction;
  raw: unknown;
}

export interface SendResult {
  txId: string;
  raw: unknown;
}

interface TransactionApiConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
}

// approvalCheck() and dryRun() both go through the Binance Web3 API's
// Transaction API — the same non-custodial, HMAC-signed product
// lib/data/quotes.ts talks to, confirmed via portal reference. Not a
// separate "Agentic Wallet" product: that turned out to have no
// confirmed headless server-to-server API at all (only a human
// QR-sign-in/Skills flow), so it was dropped from this file entirely.
function getTransactionApiConfig(): TransactionApiConfig {
  const baseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const secretKey = process.env.BINANCE_WEB3_API_SECRET;
  if (!baseUrl || !apiKey || !secretKey) {
    throw new Error(
      "NotImplemented: BINANCE_WEB3_API_BASE_URL / BINANCE_WEB3_API_KEY / " +
        "BINANCE_WEB3_API_SECRET are not set. approvalCheck()/dryRun() are built " +
        "against the documented Binance Web3 Transaction API shape but have no " +
        "live credentials configured yet — see .env.example."
    );
  }
  return { baseUrl, apiKey, secretKey };
}

// Real HMAC-SHA256 signing scheme per web3.binance.com/en/dev-docs/authentication
// — confirmed authoritative for the Trading/Transaction API (an earlier
// concern that this product might instead use RSA/Ed25519 key-pair
// signing turned out to be a different, unrelated Binance product).
// Same confirmed scheme as lib/data/quotes.ts's buildAuthHeaders,
// duplicated here (not shared via a common util) so this module's auth
// can be updated independently if this specific endpoint's requirements
// ever diverge from the quote endpoint's.
export function buildTransactionApiAuthHeaders(
  apiKey: string,
  secretKey: string,
  method: string,
  url: string,
  body = "",
  timestamp: string = new Date().toISOString()
): Record<string, string> {
  const { pathname, search } = new URL(url);
  const requestPath = pathname + search;
  const preHash = `${timestamp}${method}${requestPath}${body}`;
  const signature = createHmac("sha256", secretKey).update(preHash).digest("base64");

  return {
    "X-OC-APIKEY": apiKey,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": signature,
  };
}

interface TradingWalletConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
}

// The trading-capital wallet (PRD section 7's wallet-separation matrix):
// a plain, self-funded BSC private key we hold directly — not Binance
// custody, not Agentic Wallet's MPC-keyless coordination (that product
// has no confirmed headless API; see the note on getTransactionApiConfig
// above). send() below signs locally with this key and broadcasts
// through the Binance Transaction API with MEV protection. The key never
// leaves this process.
function getTradingWalletConfig(): TradingWalletConfig {
  const rpcUrl = process.env.BSC_RPC_URL;
  const privateKey = process.env.TRADING_WALLET_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    throw new Error(
      "NotImplemented: BSC_RPC_URL / TRADING_WALLET_PRIVATE_KEY are not set. " +
        "send() signs locally (the RPC supplies nonce and gas) and broadcasts " +
        "through Binance — no live credentials configured yet. See .env.example."
    );
  }
  return { rpcUrl, privateKey: privateKey as `0x${string}` };
}

// Derives and returns only the wallet's public address — never the key
// itself — for use as SwapRequest.userWalletAddress. Safe to log.
export function getTradingWalletAddress(): string {
  const { privateKey } = getTradingWalletConfig();
  return privateKeyToAccount(privateKey).address;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return query.toString();
}

function parseUnsignedTransaction(data: Record<string, unknown>): UnsignedTransaction | undefined {
  const tx = data.tx as Record<string, unknown> | undefined;
  if (!tx) return undefined;
  if (typeof tx.to !== "string" || typeof tx.data !== "string") return undefined;
  return { to: tx.to, data: tx.data, value: typeof tx.value === "string" ? tx.value : undefined };
}

// Checks whether the wallet already has sufficient ERC-20 allowance for
// fromTokenAddress before the first swap of a given token (not needed
// for native BNB). Returns an unsigned approval transaction to sign and
// send first if not. Called before dryRun() in the pipeline.
//
// UNVERIFIED response shape: guessed by analogy with the now-confirmed
// `data.tx` field on the swap endpoint (needsApproval = tx present) —
// this specific endpoint's response has not itself been confirmed
// against a real call yet. Confirm before relying on this branch logic.
export async function approvalCheck(request: {
  binanceChainId: string;
  fromTokenAddress: string;
  amount: string;
  userWalletAddress: string;
}): Promise<ApprovalCheckResult> {
  const { baseUrl, apiKey, secretKey } = getTransactionApiConfig();
  const query = buildQuery({
    binanceChainId: request.binanceChainId,
    fromTokenAddress: request.fromTokenAddress,
    amount: request.amount,
    userWalletAddress: request.userWalletAddress,
  });
  const url = `${baseUrl}/api/v1/dex/aggregator/approve-transaction?${query}`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildTransactionApiAuthHeaders(apiKey, secretKey, "GET", url),
  });

  if (!res.ok) {
    throw new Error(`Binance Web3 Transaction API approve-transaction check failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const approvalTransaction = parseUnsignedTransaction(data);

  if (!approvalTransaction) {
    return { needsApproval: false, raw: data };
  }
  return { needsApproval: true, approvalTransaction, raw: data };
}

// Quotes and builds a swap in a single call — no separate quote step.
// Kept as its own callable step (never folded into send()) because the
// guardrail gate's dry-run-floor check depends on dry-run being a real,
// inspectable step of the pipeline, not an implementation detail hidden
// inside execution. Also the only source of the unsigned transaction
// send() later signs and broadcasts.
export async function dryRun(request: SwapRequest): Promise<DryRunResult> {
  const { baseUrl, apiKey, secretKey } = getTransactionApiConfig();
  const query = buildQuery({
    binanceChainId: request.binanceChainId,
    fromTokenAddress: request.fromTokenAddress,
    toTokenAddress: request.toTokenAddress,
    amount: request.amount,
    userWalletAddress: request.userWalletAddress,
    vendor: request.vendor,
    autoSlippage: request.autoSlippage ? "true" : undefined,
    slippagePercent: request.autoSlippage ? undefined : request.slippagePercent,
  });
  const url = `${baseUrl}/api/v1/dex/aggregator/quote-and-swap?${query}`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildTransactionApiAuthHeaders(apiKey, secretKey, "GET", url),
  });

  if (!res.ok) {
    throw new Error(`Binance Web3 Transaction API quote-and-swap failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  // Still UNVERIFIED, unlike `data.tx` above (that one's confirmed):
  // the output-amount field name hasn't itself been checked against a
  // real response. Confirm before relying on this specific field.
  const outputUsd = Number(data.simulatedOutput);
  if (!Number.isFinite(outputUsd)) {
    throw new Error(`Binance Web3 Transaction API returned a malformed quote-and-swap result: ${JSON.stringify(data)}`);
  }

  const unsignedTransaction = parseUnsignedTransaction(data);
  if (!unsignedTransaction) {
    throw new Error(`Binance Web3 Transaction API quote-and-swap response did not include a usable unsigned transaction: ${JSON.stringify(data)}`);
  }

  return { outputUsd, unsignedTransaction, raw: data };
}

// Each step is injectable so tests never touch a chain, an RPC, or
// Binance. The defaults are the real implementations.
export interface SendDeps {
  simulate: (evmTx: EvmTxToSimulate) => Promise<TxSimulation>;
  // Uses the RPC only to READ nonce, gas, and fees; signs locally. Never broadcasts.
  prepareAndSign: (tx: { to: `0x${string}`; data: `0x${string}`; value: bigint }) => Promise<`0x${string}`>;
  broadcast: (params: { signedTransaction: string; address: string }) => Promise<BroadcastResult>;
  waitForReceipt: (txHash: `0x${string}`) => Promise<{ status: "success" | "reverted" }>;
}

const RECEIPT_TIMEOUT_MS = 90_000;

function defaultSendDeps(rpcUrl: string, privateKey: `0x${string}`): SendDeps {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  return {
    simulate: (evmTx) => simulateEvmTransaction(evmTx),
    prepareAndSign: async (tx) => {
      const request = await walletClient.prepareTransactionRequest({ ...tx, account, chain: bsc });
      return walletClient.signTransaction(request);
    },
    broadcast: (params) => broadcastWithMevProtection(params),
    waitForReceipt: async (hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      return { status: receipt.status };
    },
  };
}

// The only send path. In order:
//   1. Binance Transaction API simulation of the exact unsigned
//      transaction — it must predict SUCCESS, or nothing is signed.
//   2. Local signing with the trading wallet's key (the RPC is used only
//      to read nonce, gas, and fees).
//   3. Broadcast through Binance with MEV protection (private mempool).
//      If it fails, this throws. There is deliberately no fallback to the
//      public RPC: that would silently drop MEV protection.
//   4. Wait for the receipt; a revert throws.
// Never returns a fabricated transaction ID.
export async function send(unsignedTransaction: UnsignedTransaction, deps: Partial<SendDeps> = {}): Promise<SendResult> {
  const { rpcUrl, privateKey } = getTradingWalletConfig();
  const steps = { ...defaultSendDeps(rpcUrl, privateKey), ...deps };
  const from = privateKeyToAccount(privateKey).address;
  const value = unsignedTransaction.value ?? "0";

  const simulation = await steps.simulate({ from, to: unsignedTransaction.to, value, data: unsignedTransaction.data });
  if (simulation.result !== "succeeded") {
    const why = simulation.result === "failed" ? `${simulation.status}: ${simulation.failReason}` : simulation.reason;
    throw new Error(`not sent: Binance simulation did not predict success (${why})`);
  }

  const signedTransaction = await steps.prepareAndSign({
    to: unsignedTransaction.to as `0x${string}`,
    data: unsignedTransaction.data as `0x${string}`,
    value: BigInt(value),
  });

  const { txHash, orderId } = await steps.broadcast({ signedTransaction, address: from });

  const receipt = await steps.waitForReceipt(txHash as `0x${string}`);
  if (receipt.status !== "success") throw new Error(`transaction ${txHash} was mined but reverted`);

  return { txId: txHash, raw: { orderId, simulation } };
}
