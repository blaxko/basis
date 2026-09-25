import { binanceRequest, defaultBinanceClientDeps, type BinanceClientDeps } from "./binance-client";

// Binance Web3 Transaction API, per the OpenAPI schema
// (web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/1.0.0/schema.json,
// operationIds simulateTransactions and broadcastTransactions), checked
// 2026-09-24.

const SIMULATE_PATH = "/api/v1/dex/pre-transaction/simulate";
const BROADCAST_PATH = "/api/v1/dex/pre-transaction/broadcast-transaction";
const BSC_CHAIN_ID = "56";

export interface EvmTxToSimulate {
  from: string;
  to: string;
  value: string; // wei, integer string
  data: string; // hex calldata
}

export interface SimulatedBalanceChange {
  contractAddress?: string;
  tokenType?: string;
  change?: string;
  owner?: string;
}

export interface SimulatedAllowanceChange {
  tokenAddress?: string;
  owner?: string;
  spender?: string;
  preAmount?: string;
  postAmount?: string;
}

// "succeeded" / "failed" are Binance's prediction about the transaction.
// "unavailable" means there is no prediction at all (HTTP or API error,
// network failure, unrecognized shape) — never treated as a success.
export type TxSimulation =
  | { result: "succeeded"; status: string; balanceChanges: SimulatedBalanceChange[]; allowanceChanges: SimulatedAllowanceChange[] }
  | { result: "failed"; status: string; failReason: string }
  | { result: "unavailable"; reason: string };

// Simulates an UNSIGNED transaction off-chain. Takes no signature, so it
// can check our own calldata before anything is signed.
export async function simulateEvmTransaction(
  evmTx: EvmTxToSimulate,
  deps: BinanceClientDeps = defaultBinanceClientDeps
): Promise<TxSimulation> {
  try {
    const res = await binanceRequest({ method: "POST", path: SIMULATE_PATH, body: { binanceChainId: BSC_CHAIN_ID, evmTx } }, deps);
    if (res.httpStatus < 200 || res.httpStatus >= 300) return { result: "unavailable", reason: `HTTP ${res.httpStatus}: ${res.text.slice(0, 500)}` };
    if (!res.body) return { result: "unavailable", reason: `response was not JSON: ${res.text.slice(0, 500)}` };
    if (res.body.code !== 0) return { result: "unavailable", reason: `code ${res.body.code}: ${res.body.msg ?? "no message"}` };

    const data = (res.body.data ?? {}) as {
      status?: string;
      failReason?: string | null;
      balanceChanges?: SimulatedBalanceChange[];
      allowanceChanges?: SimulatedAllowanceChange[];
    };
    const status = String(data.status ?? "");
    if (status.toUpperCase() === "FAILED" || (data.failReason ?? "") !== "") {
      return { result: "failed", status, failReason: data.failReason ?? "(no failReason given)" };
    }
    if (status.toUpperCase() === "SUCCESS") {
      return { result: "succeeded", status, balanceChanges: data.balanceChanges ?? [], allowanceChanges: data.allowanceChanges ?? [] };
    }
    return { result: "unavailable", reason: `unrecognized simulation status "${status}"` };
  } catch (err) {
    return { result: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface BroadcastResult {
  txHash: string;
  orderId: string;
}

// Broadcasts a locally signed transaction through Binance's relay with MEV
// protection (private mempool). There is no parameter to turn MEV
// protection off, and no fallback: any failure throws, and callers fail
// closed. Falling back to a public RPC would silently drop the protection.
export async function broadcastWithMevProtection(
  params: { signedTransaction: string; address: string },
  deps: BinanceClientDeps = defaultBinanceClientDeps
): Promise<BroadcastResult> {
  const res = await binanceRequest(
    {
      method: "POST",
      path: BROADCAST_PATH,
      body: { binanceChainId: BSC_CHAIN_ID, signedTransaction: params.signedTransaction, address: params.address, enableMevProtection: true },
    },
    deps
  );
  if (res.httpStatus < 200 || res.httpStatus >= 300) throw new Error(`Binance broadcast failed: HTTP ${res.httpStatus}: ${res.text.slice(0, 500)}`);
  if (!res.body || res.body.code !== 0) throw new Error(`Binance broadcast failed: code ${res.body?.code}: ${res.body?.msg ?? res.text.slice(0, 500)}`);
  const data = (res.body.data ?? {}) as { txHash?: string; orderId?: string };
  if (!data.txHash || !/^0x[0-9a-fA-F]{64}$/.test(data.txHash)) {
    throw new Error(`Binance broadcast returned no usable txHash: ${res.text.slice(0, 500)}`);
  }
  return { txHash: data.txHash, orderId: data.orderId ?? "" };
}
