import { NextResponse } from "next/server";
import { getKillswitchMode } from "../../../lib/orchestration/killswitch";
import { defaultBinanceCallLog, summarizeCalls } from "../../../lib/data/binance-client";
import { getTradingWalletAddress } from "../../../lib/execution/agentic-wallet";
import { isPublicReadOnly } from "../../../lib/config/deployment";
import { clientIp } from "../../../lib/config/rate-limit";
import { getLatestMarketStatuses } from "../../../lib/data/binance-rwa";

const RECENT_BINANCE_CALLS = 50;

// The derived PUBLIC address, or why the key can't be used. The key
// itself never leaves getTradingWalletAddress(). In PUBLIC_READ_ONLY mode
// the address comes from TRADING_WALLET_ADDRESS and the key variable is
// not even checked for presence.
function tradingWalletStatus(): { configured: boolean; address: string | null; error?: string } {
  if (!isPublicReadOnly() && !process.env.TRADING_WALLET_PRIVATE_KEY) return { configured: false, address: null };
  try {
    return { configured: true, address: getTradingWalletAddress() };
  } catch (err) {
    return { configured: false, address: null, error: err instanceof Error ? err.message : "invalid key" };
  }
}

// Reports whether each credential is configured, never the value itself.
// Presence checks only: this route never makes an authenticated call.
//
// What the current path depends on: Groq (intent parsing), the BSC RPC
// (pool reads, QuoterV2 simulation, nonce and gas for signing), the
// trading wallet key (local signing), and the Binance Web3 API (the
// Trading API reference quote on every tick; the Transaction API for
// simulation and MEV-protected broadcast). `binanceWeb3Api.calls` is the
// app's own record of its recent Binance calls — status, latency, and
// verbatim errors — read from memory, not re-fetched.
export async function GET(request: Request) {
  const records = defaultBinanceCallLog.recent();
  return NextResponse.json({
    publicReadOnly: isPublicReadOnly(),
    // The caller's own IP as the rate limiter sees it (see clientIp()).
    requestClientIp: clientIp(request),
    groq: { configured: Boolean(process.env.GROQ_API_KEY) },
    bscRpc: { configured: Boolean(process.env.BSC_RPC_URL) },
    tradingWallet: tradingWalletStatus(),
    binanceWeb3Api: {
      configured: Boolean(
        process.env.BINANCE_WEB3_API_BASE_URL && process.env.BINANCE_WEB3_API_KEY && process.env.BINANCE_WEB3_API_SECRET
      ),
      summary: summarizeCalls(records),
      calls: records.slice(-RECENT_BINANCE_CALLS).reverse(),
    },
    wallet: {
      tradingCapitalUsd: null,
      operatingBudgetUsd: null,
      reason: "not_implemented: no balance-query endpoint wired yet",
    },
    killswitch: getKillswitchMode(),
    // Latest underlying-market status per ticker, as the scheduler last
    // fetched it (RWA Data API). Read from memory, not re-fetched.
    marketStatus: getLatestMarketStatuses(),
  });
}
