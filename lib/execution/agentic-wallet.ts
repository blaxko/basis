import type { Side } from "../guardrails/check";

// The order shape execution needs — deliberately narrower than
// ProposedOrder (no adjustedSpread, recentTicks, etc.): those are inputs
// to the *decision*, not to the act of sending/simulating a trade.
export interface WalletOrderRequest {
  symbol: string;
  side: Side;
  sizeUsd: number;
}

export interface DryRunResult {
  outputUsd: number;
  raw: unknown;
}

export interface SendResult {
  txId: string;
  raw: unknown;
}

interface TransactionApiConfig {
  baseUrl: string;
  apiKey: string;
}

// dry-run goes through the Binance Web3 API's Transaction API (PRD
// section 8: "dry-run Transaction API across all three protocols"),
// not Agentic Wallet directly.
function getTransactionApiConfig(): TransactionApiConfig {
  const baseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "NotImplemented: BINANCE_WEB3_API_BASE_URL / BINANCE_WEB3_API_KEY are not set. " +
        "dryRun() is built against the documented Binance Web3 Transaction API dry-run " +
        "shape but has no live credentials configured yet — see .env.example."
    );
  }
  return { baseUrl, apiKey };
}

interface AgenticWalletConfig {
  baseUrl: string;
  apiKey: string;
}

function getAgenticWalletConfig(): AgenticWalletConfig {
  const baseUrl = process.env.AGENTIC_WALLET_API_BASE_URL;
  const apiKey = process.env.AGENTIC_WALLET_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "NotImplemented: AGENTIC_WALLET_API_BASE_URL / AGENTIC_WALLET_API_KEY are not set. " +
        "send() is built against the documented Agentic Wallet execute shape but has no " +
        "live credentials configured yet — see .env.example. Refusing to return a " +
        "fabricated transaction ID."
    );
  }
  return { baseUrl, apiKey };
}

// Simulates an order against the Binance Web3 Transaction API without
// moving funds. Kept as its own callable step (never folded into send())
// because the guardrail gate's dry-run-floor check depends on dry-run
// being a real, inspectable step of the pipeline, not an implementation
// detail hidden inside execution.
export async function dryRun(order: WalletOrderRequest): Promise<DryRunResult> {
  const { baseUrl, apiKey } = getTransactionApiConfig();

  const res = await fetch(`${baseUrl}/transaction/dry-run`, {
    method: "POST",
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol: order.symbol, side: order.side, sizeUsd: order.sizeUsd }),
  });

  if (!res.ok) {
    throw new Error(`Binance Web3 Transaction API dry-run failed for ${order.symbol}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const outputUsd = Number(data.simulatedOutput);
  if (!Number.isFinite(outputUsd)) {
    throw new Error(`Binance Web3 Transaction API returned a malformed dry-run result for ${order.symbol}: ${JSON.stringify(data)}`);
  }

  return { outputUsd, raw: data };
}

// Executes a live order through Agentic Wallet. Never returns a
// fabricated transaction ID: if credentials aren't configured, or the
// upstream response is malformed, it throws rather than faking success.
export async function send(order: WalletOrderRequest): Promise<SendResult> {
  const { baseUrl, apiKey } = getAgenticWalletConfig();

  const res = await fetch(`${baseUrl}/wallet/execute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol: order.symbol, side: order.side, sizeUsd: order.sizeUsd }),
  });

  if (!res.ok) {
    throw new Error(`Agentic Wallet execute failed for ${order.symbol}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const txId = typeof data.txId === "string" ? data.txId : "";
  if (!txId) {
    throw new Error(`Agentic Wallet returned a malformed execute result for ${order.symbol}: ${JSON.stringify(data)}`);
  }

  return { txId, raw: data };
}
