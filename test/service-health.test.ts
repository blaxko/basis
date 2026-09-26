import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getServiceHealth, resetServiceHealth, recordServiceOk, recordServiceFailure } from "../lib/config/service-health";
import { chatCompletion } from "../lib/llm/groq-client";
import { healthChip } from "../components/health-chip";

// The Groq and BSC RPC chips used to be green whenever a key or URL was
// set — even with a revoked key or a dead RPC (seen 2026-09-26 on local
// failure runs). They must reflect the last real call instead.

beforeEach(() => resetServiceHealth());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../lib/data/pancakeswap-v3");
  vi.doUnmock("../lib/execution/wallet-balances");
  vi.resetModules();
});

describe("service health is recorded from real calls", () => {
  it("Groq: a successful completion records ok, a 401 records a failure", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })));
    await chatCompletion([{ role: "user", content: "hi" }]);
    const ok = getServiceHealth("groq");
    expect(ok.lastOkAt).not.toBeNull();
    expect(ok.lastFailAt).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401, statusText: "Unauthorized" })));
    await chatCompletion([{ role: "user", content: "hi" }]);
    const failing = getServiceHealth("groq");
    expect(failing.lastFailAt).not.toBeNull();
    expect(failing.lastFailure).toBe("HTTP 401");
  });

  it("Groq: an unset key records nothing (it's 'not configured', not 'failing')", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await chatCompletion([{ role: "user", content: "hi" }]);
    expect(getServiceHealth("groq")).toEqual({ lastOkAt: null, lastFailAt: null, lastFailure: null });
  });

  it("BSC RPC: pool reads record ok and failure", async () => {
    vi.resetModules();
    const readPoolPrice = vi.fn();
    vi.doMock("../lib/data/pancakeswap-v3", async (orig) => ({ ...(await orig<typeof import("../lib/data/pancakeswap-v3")>()), readPoolPrice }));
    const { fetchPoolQuotes } = await import("../lib/data/quotes");
    const health = await import("../lib/config/service-health");
    health.resetServiceHealth();

    readPoolPrice.mockResolvedValue({ poolAddress: "0x1", feeUnits: 2500, priceUsd: 500, liquidityUsdEstimate: 1e5, token0: "0x", token1: "0x" });
    await fetchPoolQuotes("MSFT");
    expect(health.getServiceHealth("bscRpc").lastOkAt).not.toBeNull();

    vi.spyOn(console, "error").mockImplementation(() => {});
    readPoolPrice.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    await expect(fetchPoolQuotes("MSFT")).rejects.toThrow();
    expect(health.getServiceHealth("bscRpc").lastFailure).toBe("timed out");
  });

  it("/api/status reports each service's last ok / failure time, not just 'configured'", async () => {
    vi.resetModules();
    vi.doMock("../lib/execution/wallet-balances", () => ({ readWalletBalances: async () => ({ status: "unavailable", reason: "x", readAt: "t" }) }));
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("BSC_RPC_URL", "https://rpc.example");
    const health = await import("../lib/config/service-health");
    health.resetServiceHealth();
    health.recordServiceFailure("bscRpc", "network error", Date.parse("2026-09-26T13:00:00Z"));
    const { GET } = await import("../app/api/status/route");
    const body = await (await GET(new Request("http://localhost/api/status"))).json();
    expect(body.groq).toEqual({ configured: true, lastOkAt: null, lastFailAt: null, lastFailure: null });
    expect(body.bscRpc).toEqual({ configured: true, lastOkAt: null, lastFailAt: "2026-09-26T13:00:00.000Z", lastFailure: "network error" });
  });
});

describe("health chip wording", () => {
  const NOW = Date.parse("2026-09-26T13:00:30Z");
  const at = (s: string) => new Date(Date.parse(s)).toISOString();

  it("configured, never called → neutral 'no calls yet' (not green)", () => {
    expect(healthChip("Groq", { configured: true, lastOkAt: null, lastFailAt: null, lastFailure: null }, NOW)).toEqual({
      label: "Groq · no calls yet",
      state: "unknown",
    });
  });

  it("last call ok → green, with how long ago", () => {
    expect(healthChip("BSC RPC", { configured: true, lastOkAt: at("2026-09-26T13:00:18Z"), lastFailAt: null, lastFailure: null }, NOW)).toEqual({
      label: "BSC RPC · ok 12s ago",
      state: "ok",
    });
  });

  it("last call failed → red, with the plain reason and how long ago", () => {
    const h = { configured: true, lastOkAt: at("2026-09-26T12:50:00Z"), lastFailAt: at("2026-09-26T12:58:30Z"), lastFailure: "HTTP 401" };
    expect(healthChip("Groq", h, NOW)).toEqual({ label: "Groq · failing (HTTP 401) 2 min ago", state: "failing" });
  });

  it("recovered: an ok after a failure is green again", () => {
    const h = { configured: true, lastOkAt: at("2026-09-26T13:00:00Z"), lastFailAt: at("2026-09-26T12:59:00Z"), lastFailure: "timed out" };
    expect(healthChip("BSC RPC", h, NOW).state).toBe("ok");
  });

  it("not configured → red", () => {
    expect(healthChip("Groq", { configured: false, lastOkAt: null, lastFailAt: null, lastFailure: null }, NOW)).toEqual({
      label: "Groq · not configured",
      state: "failing",
    });
  });

  it("the header uses healthChip for both chips (not `configured`)", async () => {
    const { readFileSync } = await import("node:fs");
    const header = readFileSync(`${__dirname}/../components/header.tsx`, "utf8");
    expect(header).toContain('healthChip("Groq"');
    expect(header).toContain('healthChip("BSC RPC"');
    expect(header).not.toContain("ok={status.data.groq.configured}");
    expect(header).not.toContain("ok={status.data.bscRpc.configured}");
  });

  it("recordServiceOk / recordServiceFailure keep the latest of each", () => {
    recordServiceOk("groq", Date.parse("2026-09-26T13:00:00Z"));
    recordServiceFailure("groq", "timed out", Date.parse("2026-09-26T13:01:00Z"));
    expect(getServiceHealth("groq")).toEqual({ lastOkAt: "2026-09-26T13:00:00.000Z", lastFailAt: "2026-09-26T13:01:00.000Z", lastFailure: "timed out" });
  });
});
