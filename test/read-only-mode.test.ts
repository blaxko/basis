import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublicReadOnly, getReadOnlyWalletAddress } from "../lib/config/deployment";
import { checkRateLimit, clientIp, resetRateLimits, INSTRUCTION_RATE_LIMIT } from "../lib/config/rate-limit";

// PUBLIC_READ_ONLY: nothing can reach the send path, the trading key is
// never read, "live" is refused server-side, and Binance/Groq-triggering
// routes are rate-limited per IP.

// /api/status reads the wallet's balances over RPC. These tests point the
// RPC at a fake host, so the only network step — resolving the MSFTB
// token — is stubbed to fail at once instead of waiting on DNS (which
// made the status tests flaky against vitest's 5 s limit). The real
// readWalletBalances still runs and still resolves the wallet address
// first, so the "key never read" checks keep covering that path.
vi.mock("../lib/data/gas-estimate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/data/gas-estimate")>()),
  getTargetTokenOnChain: async () => {
    throw new Error("stubbed in tests: no network");
  },
}));

const ROOT = join(__dirname, "..");
const ADDRESS = "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95";
const DUMMY_KEY = "1".repeat(64);

// Replaces process.env with a proxy that counts reads of the trading key.
let keyReads = 0;
let originalEnv: NodeJS.ProcessEnv;
function watchKeyReads(vars: Record<string, string | undefined>) {
  originalEnv = process.env;
  const target: NodeJS.ProcessEnv = { ...originalEnv, ...vars };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete target[k];
  keyReads = 0;
  process.env = new Proxy(target, {
    get(t, prop) {
      if (prop === "TRADING_WALLET_PRIVATE_KEY") keyReads += 1;
      return Reflect.get(t, prop);
    },
    has(t, prop) {
      if (prop === "TRADING_WALLET_PRIVATE_KEY") keyReads += 1;
      return Reflect.has(t, prop);
    },
  });
}

const readOnlyEnv = {
  PUBLIC_READ_ONLY: "true",
  TRADING_WALLET_ADDRESS: ADDRESS.toLowerCase(),
  // Present on purpose: read-only mode must ignore it, not merely lack it.
  TRADING_WALLET_PRIVATE_KEY: DUMMY_KEY,
  BSC_RPC_URL: "https://bsc-dataseed.example",
};

describe("PUBLIC_READ_ONLY parsing fails closed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["true", true],
    ["True", true],
    ["yes", true],
    ["1", true],
  ])("PUBLIC_READ_ONLY=%s → read-only %s", (value, expected) => {
    if (value === undefined) vi.stubEnv("PUBLIC_READ_ONLY", undefined as unknown as string);
    else vi.stubEnv("PUBLIC_READ_ONLY", value);
    if (value === undefined) delete process.env.PUBLIC_READ_ONLY;
    expect(isPublicReadOnly()).toBe(expected);
  });
});

describe("read-only mode: the trading key is never read", () => {
  beforeEach(() => watchKeyReads(readOnlyEnv));
  afterEach(() => {
    process.env = originalEnv;
  });

  it("getTradingWalletAddress returns TRADING_WALLET_ADDRESS (checksummed) without reading the key", async () => {
    const { getTradingWalletAddress } = await import("../lib/execution/agentic-wallet");
    expect(getTradingWalletAddress()).toBe(ADDRESS);
    expect(keyReads).toBe(0);
  });

  it("fails closed when TRADING_WALLET_ADDRESS is missing or invalid — still without reading the key", () => {
    delete process.env.TRADING_WALLET_ADDRESS;
    expect(() => getReadOnlyWalletAddress()).toThrow("TRADING_WALLET_ADDRESS is not set");
    process.env.TRADING_WALLET_ADDRESS = "0x1234";
    expect(() => getReadOnlyWalletAddress()).toThrow("not a valid address");
    expect(keyReads).toBe(0);
  });

  it("/api/status reports read-only and the configured address without reading the key", async () => {
    const { GET } = await import("../app/api/status/route");
    const body = await (await GET(new Request("http://x/api/status"))).json();
    expect(body.publicReadOnly).toBe(true);
    expect(body.tradingWallet).toEqual({ configured: true, address: ADDRESS });
    expect(keyReads).toBe(0);
  });
});

describe("read-only mode: nothing can reach the send path", () => {
  beforeEach(() => watchKeyReads(readOnlyEnv));
  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock("../lib/execution/execution-test");
    vi.resetModules();
  });

  it("send() refuses before touching any dependency or the key", async () => {
    const { send } = await import("../lib/execution/agentic-wallet");
    const deps = { simulate: vi.fn(), prepareAndSign: vi.fn(), broadcast: vi.fn(), waitForReceipt: vi.fn() };
    await expect(send({ to: "0xRouter", data: "0x" }, deps)).rejects.toThrow("PUBLIC_READ_ONLY: sending transactions is disabled");
    for (const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
    expect(keyReads).toBe(0);
  });

  it("the pipeline's default wallet client (send from agentic-wallet) can't send either", async () => {
    // The pipeline's only send is walletClient.send → agentic-wallet send().
    const { send } = await import("../lib/execution/agentic-wallet");
    await expect(send({ to: "0xToken", data: "0x095ea7b3" })).rejects.toThrow("PUBLIC_READ_ONLY: sending transactions is disabled");
  });

  // Records whether the route loaded the execution-test module at all.
  async function executionTestRoute() {
    vi.resetModules();
    const loaded = { module: false };
    const runExecutionTest = vi.fn(async () => ({ outcome: "refused" }));
    vi.doMock("../lib/execution/execution-test", () => {
      loaded.module = true;
      return { runExecutionTest };
    });
    const { POST } = await import("../app/api/execution-test/route");
    const res = await POST(new Request("http://x/api/execution-test", { method: "POST", body: JSON.stringify({ sizeUsd: 1, confirm: true }) }));
    return { res, loaded, runExecutionTest };
  }

  it("/api/execution-test answers 403 and never loads the execution-test module", async () => {
    const { res, loaded, runExecutionTest } = await executionTestRoute();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("PUBLIC_READ_ONLY");
    expect(loaded.module).toBe(false);
    expect(runExecutionTest).not.toHaveBeenCalled();
    expect(keyReads).toBe(0);
  });

  it("(control) outside read-only mode the same route does load the module — so the check above is meaningful", async () => {
    process.env.PUBLIC_READ_ONLY = "false";
    const { loaded, runExecutionTest } = await executionTestRoute();
    expect(loaded.module).toBe(true);
    expect(runExecutionTest).toHaveBeenCalledTimes(1);
  });

  it("runExecutionTest itself refuses in read-only mode, even if called directly", async () => {
    const { runExecutionTest } = await import("../lib/execution/execution-test");
    const { AuditLedger } = await import("../lib/execution/audit-ledger");
    const send = vi.fn();
    const entry = await runExecutionTest(
      { sizeUsd: 1, confirm: true },
      { getKillswitchMode: () => "live", spendTracker: { recordSpend: vi.fn(), getSpentToday: () => 0 }, ledger: new AuditLedger(), send }
    );
    expect(entry.outcome).toBe("refused");
    expect(entry.reason).toContain("PUBLIC_READ_ONLY");
    expect(send).not.toHaveBeenCalled();
  });

  it("the execution-test route never statically imports the execution-test module or the wallet", () => {
    const source = readFileSync(join(ROOT, "app", "api", "execution-test", "route.ts"), "utf8");
    const staticImports = [...source.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);
    expect(staticImports.some((s) => s?.includes("execution-test") || s?.includes("agentic-wallet"))).toBe(false);
  });
});

describe("read-only mode: the killswitch can't be set to live", () => {
  beforeEach(() => watchKeyReads(readOnlyEnv));
  afterEach(async () => {
    process.env = originalEnv;
    const { setKillswitchMode } = await import("../lib/orchestration/killswitch");
    setKillswitchMode("simulation");
  });

  it("setKillswitchMode('live') throws; other modes still work", async () => {
    const { setKillswitchMode, getKillswitchMode } = await import("../lib/orchestration/killswitch");
    setKillswitchMode("dry-run");
    expect(() => setKillswitchMode("live")).toThrow('PUBLIC_READ_ONLY: setting the killswitch to "live" is disabled');
    expect(getKillswitchMode()).toBe("dry-run");
  });

  it("POST /api/killswitch {mode: live} → 403 and the mode is unchanged", async () => {
    const { POST } = await import("../app/api/killswitch/route");
    const post = (mode: string) => POST(new Request("http://x/api/killswitch", { method: "POST", body: JSON.stringify({ mode }) }));
    expect((await post("simulation")).status).toBe(200);
    const res = await post("live");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ mode: "simulation" });
  });
});

describe("read-only mode: Binance/Groq-triggering routes are rate-limited per IP", () => {
  beforeEach(() => {
    resetRateLimits();
    watchKeyReads(readOnlyEnv);
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock("../lib/orchestration/handle-instruction");
    vi.resetModules();
  });

  async function instructionRoute() {
    vi.resetModules();
    const handleInstruction = vi.fn(async () => ({ ok: false, error: { kind: "stub" } }));
    vi.doMock("../lib/orchestration/handle-instruction", () => ({ handleInstruction }));
    const { POST } = await import("../app/api/instruction/route");
    const call = (ip: string) =>
      POST(new Request("http://x/api/instruction", { method: "POST", headers: { "x-real-ip": ip }, body: JSON.stringify({ instruction: "buy $1 of MSFT" }) }));
    return { call, handleInstruction };
  }

  it(`/api/instruction: ${INSTRUCTION_RATE_LIMIT.perIp} per minute per IP, then 429 with Retry-After; Groq/Binance never called for the refused one`, async () => {
    const { call, handleInstruction } = await instructionRoute();
    for (let i = 0; i < INSTRUCTION_RATE_LIMIT.perIp; i++) expect((await call("203.0.113.7")).status).not.toBe(429);
    const refused = await call("203.0.113.7");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(handleInstruction).toHaveBeenCalledTimes(INSTRUCTION_RATE_LIMIT.perIp);
    // A different client is unaffected.
    expect((await call("198.51.100.9")).status).not.toBe(429);
  });

  it("outside read-only mode there is no limit", async () => {
    process.env.PUBLIC_READ_ONLY = "false";
    const { call } = await instructionRoute();
    for (let i = 0; i < INSTRUCTION_RATE_LIMIT.perIp + 3; i++) expect((await call("203.0.113.7")).status).not.toBe(429);
  });

  it("the global limit caps total traffic even across many IPs", () => {
    const rule = { name: "t", perIp: 100, global: 3, windowMs: 60_000 };
    expect(checkRateLimit(rule, "a", 0).ok).toBe(true);
    expect(checkRateLimit(rule, "b", 1).ok).toBe(true);
    expect(checkRateLimit(rule, "c", 2).ok).toBe(true);
    expect(checkRateLimit(rule, "d", 3)).toMatchObject({ ok: false, scope: "global" });
    expect(checkRateLimit(rule, "e", 60_000).ok).toBe(true); // next window
  });

  it("a client over its own limit doesn't use up the global quota", () => {
    const rule = { name: "u", perIp: 1, global: 2, windowMs: 60_000 };
    expect(checkRateLimit(rule, "a", 0).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect(checkRateLimit(rule, "a", 1)).toMatchObject({ ok: false, scope: "ip" });
    expect(checkRateLimit(rule, "b", 2).ok).toBe(true);
  });

  it("clientIp reads only X-Real-IP (the header Railway's edge documents) — never X-Forwarded-For", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(clientIp(req({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": " 203.0.113.7 " }))).toBe("203.0.113.7");
    // A forged X-Forwarded-For next to the real header changes nothing.
    expect(clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
    // Client-settable headers Railway doesn't document are never read.
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "1.2.3.5", "true-client-ip": "1.2.3.6" }))).toBe("unknown");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("per-IP limits can't be dodged by rotating X-Forwarded-For", async () => {
    const { POST } = await (async () => {
      vi.resetModules();
      vi.doMock("../lib/orchestration/handle-instruction", () => ({ handleInstruction: vi.fn(async () => ({ ok: false, error: { kind: "stub" } })) }));
      return import("../app/api/instruction/route");
    })();
    const call = (xff: string) =>
      POST(new Request("http://x/api/instruction", { method: "POST", headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": xff }, body: JSON.stringify({ instruction: "buy $1 of MSFT" }) }));
    for (let i = 0; i < INSTRUCTION_RATE_LIMIT.perIp; i++) expect((await call(`10.0.0.${i}`)).status).not.toBe(429);
    expect((await call("10.0.0.99")).status).toBe(429);
  });

  it("/api/status echoes the client IP the app sees, so spoofing can be checked after deploying", async () => {
    const { GET } = await import("../app/api/status/route");
    const body = await (await GET(new Request("http://x/api/status", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" } }))).json();
    expect(body.requestClientIp).toBe("203.0.113.7");
  });

  it("every route that can trigger Groq or Binance calls checks the rate limit", () => {
    const routes = ["instruction", "opportunities"].map((r) => join(ROOT, "app", "api", r, "route.ts"));
    for (const file of routes) expect(readFileSync(file, "utf8"), file).toContain("checkRateLimit(");
  });
});
