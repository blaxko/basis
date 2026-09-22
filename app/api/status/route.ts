import { NextResponse } from "next/server";
import { getKillswitchMode } from "../../../lib/orchestration/killswitch";

// The only place in this route file that touches process.env — reports
// whether each credential is configured, never the value itself.
// These are presence checks, not live network pings: without real
// credentials a network ping would just be a guaranteed failure, and we
// don't want this route accidentally making an authenticated call with
// a dummy key.
export async function GET() {
  return NextResponse.json({
    binanceWeb3Api: { configured: Boolean(process.env.BINANCE_WEB3_API_BASE_URL && process.env.BINANCE_WEB3_API_KEY) },
    groq: { configured: Boolean(process.env.GROQ_API_KEY) },
    bscRpc: { configured: Boolean(process.env.BSC_RPC_URL) },
    agenticWallet: {
      configured: Boolean(process.env.AGENTIC_WALLET_API_BASE_URL && process.env.AGENTIC_WALLET_API_KEY),
    },
    wallet: {
      tradingCapitalUsd: null,
      operatingBudgetUsd: null,
      reason: "not_implemented: no balance-query endpoint wired yet",
    },
    killswitch: getKillswitchMode(),
  });
}
