import { NextResponse } from "next/server";
import { getKillswitchMode } from "../../../lib/orchestration/killswitch";

// The only place in this route file that touches process.env — reports
// whether each credential is configured, never the value itself.
// These are presence checks, not live network pings: without real
// credentials a network ping would just be a guaranteed failure, and we
// don't want this route accidentally making an authenticated call with
// a dummy key.
//
// Only what the current execution path depends on: Groq (intent
// parsing), the BSC RPC (pool reads, QuoterV2 simulation, broadcast),
// and the trading wallet key (local signing). The Binance aggregator
// and Agentic Wallet are no longer on any live path.
export async function GET() {
  return NextResponse.json({
    groq: { configured: Boolean(process.env.GROQ_API_KEY) },
    bscRpc: { configured: Boolean(process.env.BSC_RPC_URL) },
    tradingWallet: { configured: Boolean(process.env.TRADING_WALLET_PRIVATE_KEY) },
    wallet: {
      tradingCapitalUsd: null,
      operatingBudgetUsd: null,
      reason: "not_implemented: no balance-query endpoint wired yet",
    },
    killswitch: getKillswitchMode(),
  });
}
