import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  dryRun,
  send,
  approvalCheck,
  getTradingWalletAddress,
  buildTransactionApiAuthHeaders,
  type SwapRequest,
  type TradingWalletClient,
} from "./agentic-wallet";

function swapRequest(overrides: Partial<SwapRequest> = {}): SwapRequest {
  return {
    binanceChainId: "56",
    fromTokenAddress: "0xFromToken",
    toTokenAddress: "0xToToken",
    amount: "1000000",
    userWalletAddress: "0xWallet",
    vendor: "LiquidMesh",
    autoSlippage: true,
    ...overrides,
  };
}

describe("dryRun / approvalCheck without credentials configured", () => {
  const originalBaseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const originalApiKey = process.env.BINANCE_WEB3_API_KEY;
  const originalSecret = process.env.BINANCE_WEB3_API_SECRET;

  beforeEach(() => {
    delete process.env.BINANCE_WEB3_API_BASE_URL;
    delete process.env.BINANCE_WEB3_API_KEY;
    delete process.env.BINANCE_WEB3_API_SECRET;
  });

  afterEach(() => {
    if (originalBaseUrl) process.env.BINANCE_WEB3_API_BASE_URL = originalBaseUrl;
    if (originalApiKey) process.env.BINANCE_WEB3_API_KEY = originalApiKey;
    if (originalSecret) process.env.BINANCE_WEB3_API_SECRET = originalSecret;
  });

  it("dryRun throws NotImplemented rather than returning a fabricated result", async () => {
    await expect(dryRun(swapRequest())).rejects.toThrow(/NotImplemented/);
  });

  it("approvalCheck throws NotImplemented rather than returning a fabricated result", async () => {
    await expect(
      approvalCheck({ binanceChainId: "56", fromTokenAddress: "0xFromToken", amount: "1000000", userWalletAddress: "0xWallet" })
    ).rejects.toThrow(/NotImplemented/);
  });
});

describe("send / getTradingWalletAddress without credentials configured", () => {
  const originalRpcUrl = process.env.BSC_RPC_URL;
  const originalPrivateKey = process.env.TRADING_WALLET_PRIVATE_KEY;

  beforeEach(() => {
    delete process.env.BSC_RPC_URL;
    delete process.env.TRADING_WALLET_PRIVATE_KEY;
  });

  afterEach(() => {
    if (originalRpcUrl) process.env.BSC_RPC_URL = originalRpcUrl;
    if (originalPrivateKey) process.env.TRADING_WALLET_PRIVATE_KEY = originalPrivateKey;
  });

  it("send throws NotImplemented rather than returning a fake transaction ID", async () => {
    await expect(send({ to: "0xabc", data: "0xdead" })).rejects.toThrow(/NotImplemented/);
  });

  it("getTradingWalletAddress throws NotImplemented rather than deriving from nothing", () => {
    expect(() => getTradingWalletAddress()).toThrow(/NotImplemented/);
  });
});

describe("dryRun against the real quote-and-swap shape (mocked)", () => {
  const originalBaseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const originalApiKey = process.env.BINANCE_WEB3_API_KEY;
  const originalSecret = process.env.BINANCE_WEB3_API_SECRET;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BINANCE_WEB3_API_BASE_URL = "https://web3.example/build";
    process.env.BINANCE_WEB3_API_KEY = "test-key";
    process.env.BINANCE_WEB3_API_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.BINANCE_WEB3_API_BASE_URL = originalBaseUrl;
    process.env.BINANCE_WEB3_API_KEY = originalApiKey;
    process.env.BINANCE_WEB3_API_SECRET = originalSecret;
    global.fetch = originalFetch;
  });

  it("calls GET /api/v1/dex/aggregator/quote-and-swap with the real query parameters, HMAC-signed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ simulatedOutput: 199.5, tx: { to: "0xRouter", data: "0xdeadbeef", value: "0" } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await dryRun(swapRequest());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/build/api/v1/dex/aggregator/quote-and-swap");
    expect(parsed.searchParams.get("binanceChainId")).toBe("56");
    expect(parsed.searchParams.get("fromTokenAddress")).toBe("0xFromToken");
    expect(parsed.searchParams.get("toTokenAddress")).toBe("0xToToken");
    expect(parsed.searchParams.get("amount")).toBe("1000000");
    expect(parsed.searchParams.get("userWalletAddress")).toBe("0xWallet");
    expect(parsed.searchParams.get("vendor")).toBe("LiquidMesh");
    expect(parsed.searchParams.get("autoSlippage")).toBe("true");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-OC-APIKEY"]).toBe("test-key");
    expect(headers["X-OC-SIGN"]).toBeDefined();
  });

  it("sends slippagePercent instead of autoSlippage when autoSlippage is false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ simulatedOutput: 199.5, tx: { to: "0xRouter", data: "0xdeadbeef" } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await dryRun(swapRequest({ autoSlippage: false, slippagePercent: "1.5" }));

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("autoSlippage")).toBeNull();
    expect(parsed.searchParams.get("slippagePercent")).toBe("1.5");
  });

  it("parses the unsigned transaction from data.tx (confirmed field name)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        simulatedOutput: 199.5,
        tx: { to: "0xRouter", data: "0xdeadbeef", value: "0" },
      }),
    }) as unknown as typeof fetch;

    const result = await dryRun(swapRequest());
    expect(result.outputUsd).toBe(199.5);
    expect(result.unsignedTransaction).toEqual({ to: "0xRouter", data: "0xdeadbeef", value: "0" });
  });

  it("throws on a malformed response instead of returning NaN", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ somethingElse: "oops" }),
    }) as unknown as typeof fetch;

    await expect(dryRun(swapRequest())).rejects.toThrow(/malformed/);
  });

  it("throws when the response has a simulated output but no usable unsigned transaction", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ simulatedOutput: 199.5 }),
    }) as unknown as typeof fetch;

    await expect(dryRun(swapRequest())).rejects.toThrow(/unsigned transaction/);
  });

  it("throws when the upstream request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }) as unknown as typeof fetch;

    await expect(dryRun(swapRequest())).rejects.toThrow(/failed/);
  });
});

describe("approvalCheck (mocked) — needs-approval and already-approved branches", () => {
  const originalBaseUrl = process.env.BINANCE_WEB3_API_BASE_URL;
  const originalApiKey = process.env.BINANCE_WEB3_API_KEY;
  const originalSecret = process.env.BINANCE_WEB3_API_SECRET;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BINANCE_WEB3_API_BASE_URL = "https://web3.example/build";
    process.env.BINANCE_WEB3_API_KEY = "test-key";
    process.env.BINANCE_WEB3_API_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.BINANCE_WEB3_API_BASE_URL = originalBaseUrl;
    process.env.BINANCE_WEB3_API_KEY = originalApiKey;
    process.env.BINANCE_WEB3_API_SECRET = originalSecret;
    global.fetch = originalFetch;
  });

  it("needs-approval branch: returns the unsigned approval transaction when the response includes tx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tx: { to: "0xToken", data: "0xapprove" } }),
    }) as unknown as typeof fetch;

    const result = await approvalCheck({
      binanceChainId: "56",
      fromTokenAddress: "0xFromToken",
      amount: "1000000",
      userWalletAddress: "0xWallet",
    });

    expect(result.needsApproval).toBe(true);
    expect(result.approvalTransaction).toEqual({ to: "0xToken", data: "0xapprove", value: undefined });
  });

  it("already-approved branch: returns needsApproval false when the response has no tx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ allowance: "unlimited" }),
    }) as unknown as typeof fetch;

    const result = await approvalCheck({
      binanceChainId: "56",
      fromTokenAddress: "0xFromToken",
      amount: "1000000",
      userWalletAddress: "0xWallet",
    });

    expect(result.needsApproval).toBe(false);
    expect(result.approvalTransaction).toBeUndefined();
  });

  it("calls GET /api/v1/dex/aggregator/approve-transaction with the real query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await approvalCheck({
      binanceChainId: "56",
      fromTokenAddress: "0xFromToken",
      amount: "1000000",
      userWalletAddress: "0xWallet",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/build/api/v1/dex/aggregator/approve-transaction");
    expect(parsed.searchParams.get("fromTokenAddress")).toBe("0xFromToken");
  });

  it("throws when the upstream request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }) as unknown as typeof fetch;

    await expect(
      approvalCheck({ binanceChainId: "56", fromTokenAddress: "0xFromToken", amount: "1000000", userWalletAddress: "0xWallet" })
    ).rejects.toThrow(/failed/);
  });
});

describe("send — signs locally via an injected trading wallet client and broadcasts", () => {
  const originalRpcUrl = process.env.BSC_RPC_URL;
  const originalPrivateKey = process.env.TRADING_WALLET_PRIVATE_KEY;

  beforeEach(() => {
    process.env.BSC_RPC_URL = "https://bsc-dataseed.example";
    process.env.TRADING_WALLET_PRIVATE_KEY = "0x" + "1".repeat(64);
  });

  afterEach(() => {
    process.env.BSC_RPC_URL = originalRpcUrl;
    process.env.TRADING_WALLET_PRIVATE_KEY = originalPrivateKey;
  });

  it("signs and broadcasts the unsigned transaction, returning its hash as txId", async () => {
    const mockWalletClient: TradingWalletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xtxhash123"),
    };

    const result = await send({ to: "0xRouter", data: "0xdeadbeef", value: "1000" }, { walletClient: mockWalletClient });

    expect(result.txId).toBe("0xtxhash123");
    expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
      to: "0xRouter",
      data: "0xdeadbeef",
      value: 1000n,
    });
  });

  it("omits value when the unsigned transaction doesn't specify one", async () => {
    const mockWalletClient: TradingWalletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xtxhash456"),
    };

    await send({ to: "0xRouter", data: "0xdeadbeef" }, { walletClient: mockWalletClient });

    expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
      to: "0xRouter",
      data: "0xdeadbeef",
      value: undefined,
    });
  });

  it("propagates a broadcast failure rather than returning a fake transaction ID", async () => {
    const mockWalletClient: TradingWalletClient = {
      sendTransaction: vi.fn().mockRejectedValue(new Error("insufficient funds")),
    };

    await expect(send({ to: "0xRouter", data: "0xdead" }, { walletClient: mockWalletClient })).rejects.toThrow(
      "insufficient funds"
    );
  });
});

describe("getTradingWalletAddress — derives and returns only the public address", () => {
  const originalRpcUrl = process.env.BSC_RPC_URL;
  const originalPrivateKey = process.env.TRADING_WALLET_PRIVATE_KEY;

  beforeEach(() => {
    process.env.BSC_RPC_URL = "https://bsc-dataseed.example";
    // A syntactically valid throwaway test key — never a real funded wallet.
    process.env.TRADING_WALLET_PRIVATE_KEY = "0x" + "1".repeat(64);
  });

  afterEach(() => {
    process.env.BSC_RPC_URL = originalRpcUrl;
    process.env.TRADING_WALLET_PRIVATE_KEY = originalPrivateKey;
  });

  it("returns a checksummed 0x address, not the private key", () => {
    const address = getTradingWalletAddress();
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(address).not.toContain("1".repeat(64));
  });
});

describe("buildTransactionApiAuthHeaders — real HMAC-SHA256 scheme, same as lib/data/quotes.ts's buildAuthHeaders", () => {
  it("computes X-OC-SIGN as base64(HMAC-SHA256(timestamp + method + requestPath + body, secretKey))", () => {
    const timestamp = "2026-09-23T12:00:00.000Z";
    const url = "https://web3.binance.com/build/api/v1/dex/aggregator/quote-and-swap?amount=1";

    const headers = buildTransactionApiAuthHeaders("test-key", "test-secret", "GET", url, "", timestamp);

    const expectedPreHash = `${timestamp}GET/build/api/v1/dex/aggregator/quote-and-swap?amount=1`;
    const expectedSignature = createHmac("sha256", "test-secret").update(expectedPreHash).digest("base64");

    expect(headers).toEqual({
      "X-OC-APIKEY": "test-key",
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": expectedSignature,
    });
  });
});
