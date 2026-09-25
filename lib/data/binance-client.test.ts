import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  binanceRequest,
  BinanceCallLog,
  BINANCE_RECV_WINDOW_MS,
  MAX_CALL_RECORDS,
  summarizeCalls,
  type BinanceClientDeps,
  type BinanceCallRecord,
} from "./binance-client";

function deps(response: { status: number; text: string } | Error): BinanceClientDeps & { fetchFn: ReturnType<typeof vi.fn> } {
  let t = 1000;
  return {
    fetchFn: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return { ok: response.status >= 200 && response.status < 300, status: response.status, text: async () => response.text } as Response;
    }),
    getConfigFn: () => ({ baseUrl: "https://web3.binance.com/build", apiKey: "key", secretKey: "secret" }),
    callLog: new BinanceCallLog(),
    now: () => (t += 250),
  };
}

describe("binanceRequest — every call is recorded", () => {
  it("records HTTP status, latency, and API code for a success", async () => {
    const d = deps({ status: 200, text: JSON.stringify({ code: 0, msg: "success", data: [] }) });
    const res = await binanceRequest({ method: "GET", path: "/api/v1/dex/aggregator/quote", query: new URLSearchParams({ binanceChainId: "56" }) }, d);

    expect(res.httpStatus).toBe(200);
    expect(res.latencyMs).toBe(250);
    expect(d.callLog.recent()).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/dex/aggregator/quote",
        query: "binanceChainId=56",
        httpStatus: 200,
        latencyMs: 250,
        apiCode: 0,
        ok: true,
      }),
    ]);
  });

  it("records the verbatim body for a non-2xx response", async () => {
    const d = deps({ status: 401, text: '{"code":40101,"msg":"Invalid API key"}' });
    await binanceRequest({ method: "GET", path: "/p" }, d);
    expect(d.callLog.recent()[0]).toEqual(
      expect.objectContaining({ httpStatus: 401, apiCode: 40101, ok: false, error: '{"code":40101,"msg":"Invalid API key"}' })
    );
  });

  it("records the API's own message for HTTP 200 with a non-zero code", async () => {
    const d = deps({ status: 200, text: JSON.stringify({ code: 40001, msg: "Parameter [evmTx] error: required" }) });
    await binanceRequest({ method: "POST", path: "/p", body: { a: 1 } }, d);
    expect(d.callLog.recent()[0]).toEqual(expect.objectContaining({ ok: false, apiCode: 40001, error: "code 40001: Parameter [evmTx] error: required" }));
  });

  it("records a network failure, then rethrows it", async () => {
    const d = deps(new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND web3.binance.com") }));
    await expect(binanceRequest({ method: "GET", path: "/p" }, d)).rejects.toThrow("fetch failed");
    expect(d.callLog.recent()[0]).toEqual(
      expect.objectContaining({ httpStatus: null, ok: false, error: "TypeError: fetch failed (cause: getaddrinfo ENOTFOUND web3.binance.com)" })
    );
  });

  it("signs POST bodies: the HMAC covers timestamp + method + path + query + body", async () => {
    const d = deps({ status: 200, text: JSON.stringify({ code: 0 }) });
    const body = { binanceChainId: "56", evmTx: { from: "0xa", to: "0xb", value: "0", data: "0x" } };
    await binanceRequest({ method: "POST", path: "/api/v1/dex/pre-transaction/simulate", body }, d);

    const [, init] = d.fetchFn.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    const expected = createHmac("sha256", "secret")
      .update(`${headers["X-OC-TIMESTAMP"]}POST/build/api/v1/dex/pre-transaction/simulate${JSON.stringify(body)}`)
      .digest("base64");
    expect(headers["X-OC-SIGN"]).toBe(expected);
    expect(headers["Content-Type"]).toBe("application/json");
    expect((init as RequestInit).body).toBe(JSON.stringify(body));
  });

  it("sends X-OC-RECV-WINDOW: 15000, unsigned — the signature is still over timestamp + method + path + query + body only", async () => {
    expect(BINANCE_RECV_WINDOW_MS).toBe(15_000);
    // Above the slowest transit seen (9.0 s, docs/devex-log.md 2026-09-25), within Binance's 60 s max.
    expect(BINANCE_RECV_WINDOW_MS).toBeGreaterThan(9_000);
    expect(BINANCE_RECV_WINDOW_MS).toBeLessThanOrEqual(60_000);

    for (const req of [
      { method: "GET" as const, path: "/api/v1/dex/aggregator/quote", query: new URLSearchParams({ binanceChainId: "56", amount: "1" }) },
      { method: "POST" as const, path: "/api/v1/dex/pre-transaction/simulate", body: { binanceChainId: "56" } },
    ]) {
      const d = deps({ status: 200, text: JSON.stringify({ code: 0 }) });
      await binanceRequest(req, d);
      const headers = (d.fetchFn.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-OC-RECV-WINDOW"]).toBe("15000");

      const path = `/build${req.path}${"query" in req && req.query ? `?${req.query}` : ""}`;
      const body = "body" in req ? JSON.stringify(req.body) : "";
      const signedWithout = createHmac("sha256", "secret").update(`${headers["X-OC-TIMESTAMP"]}${req.method}${path}${body}`).digest("base64");
      expect(headers["X-OC-SIGN"]).toBe(signedWithout);
    }
  });

  it("throws without calling out, or recording, when credentials are missing", async () => {
    const d = deps({ status: 200, text: "{}" });
    d.getConfigFn = () => {
      throw new Error("NotImplemented");
    };
    await expect(binanceRequest({ method: "GET", path: "/p" }, d)).rejects.toThrow("NotImplemented");
    expect(d.fetchFn).not.toHaveBeenCalled();
    expect(d.callLog.recent()).toEqual([]);
  });
});

describe("BinanceCallLog", () => {
  it("keeps only the most recent records", () => {
    const log = new BinanceCallLog();
    for (let i = 0; i < MAX_CALL_RECORDS + 5; i++) {
      log.record({ at: String(i), method: "GET", path: "/p", query: "", httpStatus: 200, latencyMs: i, apiCode: 0, ok: true });
    }
    const recent = log.recent();
    expect(recent).toHaveLength(MAX_CALL_RECORDS);
    expect(recent[0]!.at).toBe("5");
  });

  it("is shared across module instances (scheduler and API routes are separate bundles)", async () => {
    vi.resetModules();
    const a = await import("./binance-client");
    vi.resetModules();
    const b = await import("./binance-client");
    expect(b).not.toBe(a);
    const entry: BinanceCallRecord = { at: "shared", method: "GET", path: "/p", query: "", httpStatus: 200, latencyMs: 1, apiCode: 0, ok: true };
    a.defaultBinanceCallLog.record(entry);
    expect(b.defaultBinanceCallLog.recent()).toContainEqual(entry);
  });
});

describe("summarizeCalls", () => {
  it("counts successes and failures and reports latency percentiles over calls that got a response", () => {
    const records: BinanceCallRecord[] = [100, 200, 300, 400, 1000].map((latencyMs, i) => ({
      at: String(i),
      method: "GET",
      path: "/p",
      query: "",
      httpStatus: 200,
      latencyMs,
      apiCode: 0,
      ok: true,
    }));
    records.push({ at: "x", method: "GET", path: "/p", query: "", httpStatus: null, latencyMs: 10_000, apiCode: null, ok: false, error: "timeout" });
    expect(summarizeCalls(records)).toEqual({ count: 6, ok: 5, failed: 1, latencyMs: { p50: 300, p95: 1000, max: 1000 } });
  });
});
