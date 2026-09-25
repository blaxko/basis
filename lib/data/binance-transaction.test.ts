import { describe, it, expect, vi } from "vitest";
import { simulateEvmTransaction, broadcastWithMevProtection } from "./binance-transaction";
import { BinanceCallLog, type BinanceClientDeps } from "./binance-client";

function deps(response: { status: number; text: string } | Error): BinanceClientDeps & { fetchFn: ReturnType<typeof vi.fn> } {
  return {
    fetchFn: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return { ok: response.status >= 200 && response.status < 300, status: response.status, text: async () => response.text } as Response;
    }),
    getConfigFn: () => ({ baseUrl: "https://web3.binance.com/build", apiKey: "k", secretKey: "s" }),
    callLog: new BinanceCallLog(),
    now: () => 0,
  };
}

const EVM_TX = { from: "0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7", to: "0x1b81D678ffb9C0263b24A97847620C99d213eB14", value: "0", data: "0x414bf389" };

// REAL responses, verbatim, from docs/devex-log.md (2026-09-25 05:38 UTC).
const REAL_SWAP_FAILED =
  '{"code":0,"msg":"success","data":{"status":"FAILED","failReason":"execution reverted: STF","balanceChanges":[],"allowanceChanges":[]},"timestamp":1790314704072,"success":true}';
const REAL_APPROVE_SUCCESS =
  '{"code":0,"msg":"success","data":{"status":"SUCCESS","failReason":"","balanceChanges":[],"allowanceChanges":[{"tokenAddress":"0x55d398326f99059ff775485246999027b3197955","owner":"0x5b281f6e028466ceeb8b8fb6685e35ec2b8f02f7","spender":"0x1b81d678ffb9c0263b24a97847620c99d213eb14","preAmount":"0","postAmount":"5000000000000000000"}]},"timestamp":1790314704845,"success":true}';

describe("simulateEvmTransaction", () => {
  it("posts the documented body to the simulate endpoint", async () => {
    const d = deps({ status: 200, text: REAL_APPROVE_SUCCESS });
    await simulateEvmTransaction(EVM_TX, d);
    const [url, init] = d.fetchFn.mock.calls[0]!;
    expect(new URL(url as string).pathname).toBe("/build/api/v1/dex/pre-transaction/simulate");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ binanceChainId: "56", evmTx: EVM_TX });
  });

  it("reads the real FAILED response (our swap from the unfunded wallet) as a predicted failure with Binance's reason", async () => {
    expect(await simulateEvmTransaction(EVM_TX, deps({ status: 200, text: REAL_SWAP_FAILED }))).toEqual({
      result: "failed",
      status: "FAILED",
      failReason: "execution reverted: STF",
    });
  });

  it("reads the real SUCCESS response (with its empty-string failReason) as a predicted success", async () => {
    const result = await simulateEvmTransaction(EVM_TX, deps({ status: 200, text: REAL_APPROVE_SUCCESS }));
    expect(result.result).toBe("succeeded");
    expect(result.result === "succeeded" && result.allowanceChanges[0]?.postAmount).toBe("5000000000000000000");
  });

  it.each([
    ["an HTTP error", { status: 500, text: "internal error" }, "HTTP 500: internal error"],
    ["a non-zero API code", { status: 200, text: '{"code":40001,"msg":"Parameter [evmTx] error"}' }, "code 40001: Parameter [evmTx] error"],
    ["an unknown status", { status: 200, text: '{"code":0,"data":{"status":"PENDING"}}' }, 'unrecognized simulation status "PENDING"'],
  ])("is unavailable — never a success — for %s", async (_label, response, reason) => {
    expect(await simulateEvmTransaction(EVM_TX, deps(response))).toEqual({ result: "unavailable", reason });
  });

  it("is unavailable when the request fails outright", async () => {
    expect(await simulateEvmTransaction(EVM_TX, deps(new Error("fetch failed")))).toEqual({ result: "unavailable", reason: "fetch failed" });
  });
});

describe("broadcastWithMevProtection", () => {
  const TX_HASH = "0x" + "cd".repeat(32);

  it("always sends enableMevProtection: true, with the signed transaction and sender", async () => {
    const d = deps({ status: 200, text: JSON.stringify({ code: 0, msg: "success", data: { txHash: TX_HASH, orderId: "o-1" } }) });
    const result = await broadcastWithMevProtection({ signedTransaction: "0xf86c", address: EVM_TX.from }, d);

    expect(result).toEqual({ txHash: TX_HASH, orderId: "o-1" });
    const [url, init] = d.fetchFn.mock.calls[0]!;
    expect(new URL(url as string).pathname).toBe("/build/api/v1/dex/pre-transaction/broadcast-transaction");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      binanceChainId: "56",
      signedTransaction: "0xf86c",
      address: EVM_TX.from,
      enableMevProtection: true,
    });
  });

  it.each([
    ["an HTTP error", { status: 502, text: "bad gateway" }, "Binance broadcast failed: HTTP 502: bad gateway"],
    ["a non-zero API code", { status: 200, text: '{"code":40311,"msg":"nonce too low"}' }, "Binance broadcast failed: code 40311: nonce too low"],
    ["a missing txHash", { status: 200, text: '{"code":0,"data":{"orderId":"o"}}' }, "no usable txHash"],
  ])("throws — fails closed — on %s", async (_label, response, message) => {
    await expect(broadcastWithMevProtection({ signedTransaction: "0xf86c", address: EVM_TX.from }, deps(response))).rejects.toThrow(message);
  });

  it("propagates a network failure", async () => {
    await expect(broadcastWithMevProtection({ signedTransaction: "0xf86c", address: EVM_TX.from }, deps(new Error("fetch failed")))).rejects.toThrow("fetch failed");
  });
});
