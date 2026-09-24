import { describe, it, expect, vi } from "vitest";
import { handleInstruction } from "./handle-instruction";
import { DailySpendTracker } from "./spend-tracker";
import { AuditLedger } from "../execution/audit-ledger";
import type { Quote } from "../data/types";
import type { WalletClient, SwapRequest } from "../execution/pipeline";
import type { chatCompletion, GroqChatResult } from "../llm/groq-client";

const NOW = Date.UTC(2025, 7, 20, 12, 0, 0);

function nvdaQuotes(): Quote[] {
  return [
    { protocol: "xstocks", underlying: "NVDA", symbol: "NVDAx", price: 101, liquidityDepth: 5000, timestamp: NOW },
    { protocol: "ondo", underlying: "NVDA", symbol: "NVDAon", price: 101.5, liquidityDepth: 5000, timestamp: NOW },
  ];
}

function mockChat(result: GroqChatResult): typeof chatCompletion {
  return vi.fn().mockResolvedValue(result) as unknown as typeof chatCompletion;
}

function mockWalletClient(): WalletClient {
  return {
    approvalCheck: vi.fn().mockResolvedValue({ needsApproval: false, raw: {} }),
    dryRun: vi.fn().mockResolvedValue({ outputUsd: 199, unsignedTransaction: { to: "0xRouter", data: "0xdead" }, raw: {} }),
    send: vi.fn().mockResolvedValue({ txId: "0xdeadbeef", raw: {} }),
  };
}

// Bypasses the (currently empty) token-address registry and unset
// trading-wallet credentials — this test exercises handleInstruction()'s
// own composition, not the real Transaction API request shape.
function fakeBuildSwapRequest(): SwapRequest {
  return {
    binanceChainId: "56",
    fromTokenAddress: "0xFrom",
    toTokenAddress: "0xTo",
    amount: "200",
    userWalletAddress: "0xWallet",
    vendor: "LiquidMesh",
    autoSlippage: true,
  };
}

describe("handleInstruction — a malformed instruction never reaches runPipeline()", () => {
  it("returns a typed parse error and never touches the wallet or the ledger, for a hallucinated ticker", async () => {
    const chatCompletionFn = mockChat({ ok: true, content: '{"ticker":"GOOG","side":"buy","sizeUsd":100}' });
    const fetchQuotesFn = vi.fn();
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy some google", {
      chatCompletionFn,
      fetchQuotesFn,
      walletClient,
      ledger,
      spendTracker: new DailySpendTracker(() => NOW),
      now: () => NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema_validation");
    }
    expect(fetchQuotesFn).not.toHaveBeenCalled();
    expect(walletClient.dryRun).not.toHaveBeenCalled();
    expect(walletClient.send).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });

  it("returns a typed parse error and never touches the wallet, for a non-JSON Groq response", async () => {
    const chatCompletionFn = mockChat({ ok: true, content: "sure, buying some NVDA for you!" });
    const fetchQuotesFn = vi.fn();
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy nvda", {
      chatCompletionFn,
      fetchQuotesFn,
      walletClient,
      ledger,
      spendTracker: new DailySpendTracker(() => NOW),
      now: () => NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_json");
    }
    expect(fetchQuotesFn).not.toHaveBeenCalled();
    expect(ledger.readAll()).toHaveLength(0);
  });
});

describe("handleInstruction — valid instruction composes to an executed pipeline run", () => {
  it("sources market data independently, never trusting numeric fields from the LLM", async () => {
    // The LLM response includes an extra "price" field it was never asked
    // for — zod's schema strips it, and the order construction below
    // sources price from computeSpreads() regardless, not from this.
    const chatCompletionFn = mockChat({
      ok: true,
      content: '{"ticker":"NVDA","side":"buy","sizeUsd":200,"price":1}',
    });
    const fetchQuotesFn = vi.fn().mockResolvedValue(nvdaQuotes());
    const walletClient = mockWalletClient();
    const ledger = new AuditLedger();

    const result = await handleInstruction("buy 200 dollars of nvda", {
      chatCompletionFn,
      fetchQuotesFn,
      walletClient,
      buildSwapRequest: fakeBuildSwapRequest,
      ledger,
      getMode: () => "live",
      spendTracker: new DailySpendTracker(() => NOW),
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.price).toBe(101); // sourced from the mocked xstocks quote, not the LLM's "price": 1
      expect(result.order.sizeUsd).toBe(200);
      expect(result.outcome).toBe("executed");
      expect(result.verdict.approved).toBe(true);
    }
    expect(walletClient.dryRun).toHaveBeenCalledTimes(1);
    expect(walletClient.send).toHaveBeenCalledTimes(1);
    expect(ledger.readAll()).toHaveLength(1);
  });
});
