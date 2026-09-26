import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { handleInstruction } from "../lib/orchestration/handle-instruction";
import { AuditLedger } from "../lib/execution/audit-ledger";
import { DailySpendTracker } from "../lib/orchestration/spend-tracker";
import { fetchAggregatorReference } from "../lib/data/binance-reference";
import { fetchMarketStatus } from "../lib/data/binance-rwa";
import { BinanceCallLog, type BinanceClientDeps } from "../lib/data/binance-client";
import { readWalletBalances, resetWalletBalanceCache } from "../lib/execution/wallet-balances";
import { chatCompletion, type GroqChatResult } from "../lib/llm/groq-client";
import { redactSecrets, plainNetworkReason, safeDetail } from "../lib/errors/public-error";
import { describeInstructionResult } from "../components/instruction-result";
import { pollErrorMessage } from "../components/poll-error";

// What viem really throws when the BSC RPC is unreachable (shape observed
// 2026-09-26 on a local run with BSC_RPC_URL pointing at a dead port). The
// URL here stands in for a paid RPC endpoint with its key in the path.
const SECRET_RPC = "https://bsc-mainnet.example-rpc.io/v1/abcd1234secretkey";
function viemRpcError(): Error {
  return new Error(
    `HTTP request failed.\n\nURL: ${SECRET_RPC}\nRequest body: {"method":"eth_call","params":[{"data":"0x3850c7bd","to":"0x5018b018ceb7645c927c5cf246786f89ebcbe7ea"},"latest"]}\n \nRaw Call Arguments:\n  to:    0x5018b018ceb7645c927c5cf246786f89ebcbe7ea\n\nDocs: https://viem.sh/docs/contract/readContract\nDetails: fetch failed\nVersion: viem@2.56.8`
  );
}

// Nothing a visitor can see may carry a URL, a stack trace, the RPC's key,
// or viem's multi-line dump.
function expectPublicSafe(text: string) {
  expect(text).not.toMatch(/https?:\/\//i);
  expect(text).not.toContain("secretkey");
  expect(text).not.toContain("Request body");
  expect(text).not.toContain("viem");
  expect(text).not.toMatch(/\n\s+at /); // stack frame
}

const parsedMsft = (side = "buy") =>
  vi.fn().mockResolvedValue({ ok: true, content: `{"ticker":"MSFT","side":"${side}","sizeUsd":200}` } satisfies GroqChatResult) as unknown as typeof chatCompletion;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("RPC down: a valid MSFT order says price data is unavailable, never 'no pools known'", () => {
  it("handleInstruction returns price_data_unavailable with a public-safe message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ledger = new AuditLedger();
    const result = await handleInstruction("Buy $200 of MSFT", {
      chatCompletionFn: parsedMsft(),
      fetchPoolQuotesFn: vi.fn().mockRejectedValue(viemRpcError()),
      ledger,
      spendTracker: new DailySpendTracker(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("price_data_unavailable");
    expectPublicSafe(JSON.stringify(result));
    expect(ledger.readAll()).toHaveLength(0);
  });

  it("the full error is logged server-side, with the URL and key redacted", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleInstruction("Buy $200 of MSFT", {
      chatCompletionFn: parsedMsft(),
      fetchPoolQuotesFn: vi.fn().mockRejectedValue(viemRpcError()),
      ledger: new AuditLedger(),
      spendTracker: new DailySpendTracker(),
    });
    const text = logged.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).toContain("HTTP request failed");
    expect(text).not.toContain("secretkey");
    expect(text).not.toContain("bsc-mainnet.example-rpc.io");
  });

  it("a ticker with no registered pools is still 'no pools known' (NVDA)", async () => {
    const result = await handleInstruction("Buy $100 of NVDA", {
      chatCompletionFn: vi.fn().mockResolvedValue({ ok: true, content: '{"ticker":"NVDA","side":"buy","sizeUsd":100}' }) as unknown as typeof chatCompletion,
      ledger: new AuditLedger(),
      spendTracker: new DailySpendTracker(),
    });
    expect(!result.ok && result.error.kind).toBe("pool_resolution_failed");
    expectPublicSafe(JSON.stringify(result));
    expect(JSON.stringify(result)).not.toContain("lib/data"); // no source paths either
  });

  it("the instruction box words it as temporarily unavailable, never 'No pools known'", () => {
    const r = describeInstructionResult(422, { error: { kind: "price_data_unavailable", ticker: "MSFT", message: "x" } });
    expect(r.headline).toMatch(/price data is temporarily unavailable/i);
    expect(r.headline + (r.detail ?? "")).not.toMatch(/no pools known/i);
  });
});

describe("/api/opportunities: a failed live read never puts the raw error on the page", { timeout: 30_000 }, () => {
  it("returns a short public message and logs the redacted detail", async () => {
    vi.resetModules();
    vi.doMock("../lib/orchestration/agent-loop", async (orig) => ({
      ...(await orig<typeof import("../lib/orchestration/agent-loop")>()),
      previewOpportunities: vi.fn().mockRejectedValue(viemRpcError()),
    }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../app/api/opportunities/route");
    const body = await (await GET(new Request("http://localhost/api/opportunities"))).json();
    vi.doUnmock("../lib/orchestration/agent-loop");
    expect(body.error).toMatch(/temporarily unavailable/i);
    expectPublicSafe(body.error);
    const text = logged.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).toContain("HTTP request failed");
    expect(text).not.toContain("secretkey");
  });
});

describe("every other error path that reaches the page is public-safe", () => {
  const binanceDeps = (fetchFn: typeof fetch): BinanceClientDeps => ({
    fetchFn,
    getConfigFn: () => ({ baseUrl: "https://web3.binance.com/build", apiKey: "k", secretKey: "s" }),
    callLog: new BinanceCallLog(),
    now: () => 0,
  });
  const networkDown = () =>
    vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: new Error(`connect ECONNREFUSED ${SECRET_RPC}`) })) as unknown as typeof fetch;

  it("Binance reference: network failure → plain reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const q = await fetchAggregatorReference(
      { stablecoin: "0x55d398326f99059fF775485246999027B3197955", targetToken: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0", sizeUsd: 200 },
      binanceDeps(networkDown())
    );
    expect(q.status).toBe("unavailable");
    if (q.status === "unavailable") {
      expect(q.reason).toMatch(/network error|timed out/);
      expectPublicSafe(q.reason);
    }
  });

  it("Binance market status: network failure and non-2xx bodies → plain reasons", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await fetchMarketStatus("0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0", binanceDeps(networkDown()));
    expect(down.status === "unavailable" && down.reason).toMatch(/network error/);
    expectPublicSafe(JSON.stringify(down));

    const html = vi.fn().mockResolvedValue(new Response(`<html>502 from ${SECRET_RPC}</html>`, { status: 502 })) as unknown as typeof fetch;
    const bad = await fetchMarketStatus("0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0", binanceDeps(html));
    expect(bad.status === "unavailable" && bad.reason).toBe("HTTP 502");
  });

  it("the Binance call log keeps its verbatim errors but with URLs redacted", async () => {
    const deps = binanceDeps(networkDown());
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchMarketStatus("0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0", deps);
    const rec = deps.callLog.recent()[0]!;
    expect(rec.error).toContain("fetch failed");
    expectPublicSafe(rec.error!);
  });

  it("wallet balances: RPC failure → plain reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetWalletBalanceCache();
    const r = await readWalletBalances({
      getAddress: () => "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95",
      resolveMsftb: () => Promise.reject(viemRpcError()),
      getErc20Balance: async () => 0n,
      getNativeBalance: async () => 0n,
      getBlockNumber: async () => 0n,
      now: () => 0,
    });
    expect(r.status).toBe("unavailable");
    expectPublicSafe(JSON.stringify(r));
  });

  it("Groq network failure → plain reason", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", networkDown());
    const r = await chatCompletion([{ role: "user", content: "hi" }]);
    vi.unstubAllGlobals();
    expect(r.ok).toBe(false);
    expectPublicSafe(JSON.stringify(r));
  });

  it("dashboard poll errors never show a route URL", () => {
    expect(pollErrorMessage(500, null)).toBe("the server returned an error (HTTP 500)");
    expect(pollErrorMessage(429, { error: "rate limited (ip); retry in 12s" })).toBe("rate limited (ip); retry in 12s");
  });

  it("a network failure in the instruction box shows no raw error text", () => {
    const r = describeInstructionResult(null, { message: "TypeError: Failed to fetch" });
    expect(r.headline).toBe("Couldn't reach the server.");
    expect(r.detail ?? "").not.toContain("TypeError");
  });
});

describe("public-error helpers", () => {
  it("redactSecrets strips URLs, configured secret values and 64-hex strings", () => {
    vi.stubEnv("BSC_RPC_URL", SECRET_RPC);
    vi.stubEnv("GROQ_API_KEY", "gsk_live_abcdef123456");
    const out = redactSecrets(`at ${SECRET_RPC} key gsk_live_abcdef123456 pk 0x${"ab".repeat(32)} host bsc-mainnet.example-rpc.io/v1/abcd1234secretkey`);
    expect(out).not.toContain("secretkey");
    expect(out).not.toContain("gsk_live");
    expect(out).not.toContain("ab".repeat(32));
    expect(out).not.toMatch(/https?:\/\//);
  });

  it("plainNetworkReason classifies timeouts and network failures", () => {
    expect(plainNetworkReason(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("timed out");
    expect(plainNetworkReason(viemRpcError())).toBe("network error");
    expect(plainNetworkReason(new Error("something odd"))).toBe("unexpected error");
  });

  it("safeDetail keeps only a short, redacted first line", () => {
    const d = safeDetail(viemRpcError());
    expect(d).toBe("HTTP request failed.");
    expectPublicSafe(safeDetail(new Error(`insufficient funds at ${SECRET_RPC}`)));
  });
});

describe("audit: no raw error message reaches a response without going through lib/errors/public-error.ts", () => {
  // Every `err.message` in server or UI code must be wrapped by a helper
  // from lib/errors/public-error.ts. New raw uses fail this test.
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
    }
  };
  for (const d of ["lib", "app", "components"]) walk(join(root, d));
  const allowed = new Set(["lib/errors/public-error.ts"]);

  it("finds no raw `err.message` outside the helper", () => {
    const offenders = files
      .map((f) => relative(root, f).replace(/\\/g, "/"))
      .filter((f) => !allowed.has(f))
      // `err.message` / `error.message` on a caught value; `result.error.message`
      // (an already-typed, already-safe field) doesn't match.
      .filter((f) => /(?<![.\w])err(?:or)?\.message\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
