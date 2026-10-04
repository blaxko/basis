import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// What happens on the PUBLIC, READ-ONLY build when the net edge turns
// positive. The real scheduler tick, agent loop, guardrail gate, pipeline,
// audit ledger and API routes all run; only the outside world is replaced
// (the pools' prices, gas, Binance's quote and market status). The
// dashboard's panels are then rendered from what the real routes returned,
// and what they say is checked: a positive edge is shown clearly, as an
// order that passed the checks and was NOT sent, never as a trade.

const ADDRESS = "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95";
const MSFTB = "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0";

const world = vi.hoisted(() => {
  // Public, read-only: no key, only the public address.
  process.env.PUBLIC_READ_ONLY = "true";
  process.env.TRADING_WALLET_ADDRESS = "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95";
  delete process.env.TRADING_WALLET_PRIVATE_KEY;
  return {
    // The 0.25% pool is the cheap one at $500; the 1% pool's price is set per scenario.
    dearPrice: 510,
    polled: {} as Record<string, unknown>,
    send: vi.fn(),
  };
});

vi.mock("../components/use-poll", () => ({
  usePoll: (url: string) => ({ data: world.polled[url] ?? null, error: null, loading: false, refetch: () => {} }),
}));

vi.mock("../lib/data/quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/data/quotes")>()),
  fetchPoolQuotes: async (ticker: string) => [
    { ticker, poolAddress: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 500, liquidityUsdEstimate: 80_000, timestamp: Date.now() },
    { ticker, poolAddress: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: world.dearPrice, liquidityUsdEstimate: 60_000, timestamp: Date.now() },
  ],
}));

vi.mock("../lib/data/gas-estimate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/data/gas-estimate")>()),
  estimateRoundTripGasUsd: async () => ({ gasCostUsd: 0.03, source: "live" as const }),
  getTargetTokenOnChain: async () => ({ address: MSFTB, decimals: 18 }),
}));

vi.mock("../lib/data/binance-reference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/data/binance-reference")>()),
  fetchAggregatorReference: async () => ({ status: "ok" as const, priceUsd: 500.4, vendor: "LiquidMesh", route: "test" }),
}));

vi.mock("../lib/data/binance-rwa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/data/binance-rwa")>()),
  fetchMarketStatus: async () => ({
    status: "ok" as const,
    openState: true,
    reasonCode: "TRADING",
    marketStatus: null,
    reasonMsg: null,
    nextOpenTime: null,
    nextCloseTime: null,
    fetchedAt: new Date().toISOString(),
  }),
}));

// The only function that could move money. It must never be reached.
vi.mock("../lib/execution/agentic-wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/execution/agentic-wallet")>()),
  send: world.send,
}));

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

const health = { configured: true, lastOkAt: null, lastFailAt: null, lastFailure: null };

interface Scenario {
  opportunities: any;
  ledger: any;
  reading: any;
  html: { spread: string; gate: string; ledger: string; header: string; landing: string };
  mode: string;
  setLiveError: unknown;
}

// A fresh server: new ledger, price history and killswitch, then 11
// scheduler ticks (the first 10 build the price history the sanity check
// needs, the 11th can build an order), then every route and panel.
async function run(dearPrice: number): Promise<Scenario> {
  const g = globalThis as unknown as Record<symbol, unknown>;
  for (const k of ["basis.auditLedger.default", "basis.priceHistory.default", "basis.killswitch.state"]) delete g[Symbol.for(k)];
  vi.resetModules();
  world.dearPrice = dearPrice;
  world.polled = {};
  world.send.mockClear();

  const { runTick } = await import("../lib/orchestration/scheduler");
  for (let i = 0; i < 11; i++) await runTick({ log: () => {} });

  const call = (path: string) => new Request(`http://localhost${path}`, { headers: { "x-real-ip": "203.0.113.7" } });
  const opportunities = await (await (await import("../app/api/opportunities/route")).GET(call("/api/opportunities"))).json();
  const ledger = await (await (await import("../app/api/ledger/route")).GET()).json();
  const { reading } = await (await (await import("../app/api/reading/route")).GET()).json();

  const killswitch = await import("../lib/orchestration/killswitch");
  const mode = killswitch.getKillswitchMode();
  let setLiveError: unknown = null;
  try {
    killswitch.setKillswitchMode("live");
  } catch (err) {
    setLiveError = err;
  }

  world.polled = {
    "/api/opportunities": opportunities,
    "/api/ledger": ledger,
    "/api/status": {
      publicReadOnly: true,
      killswitch: mode,
      killswitchRevertsAt: null,
      groq: health,
      bscRpc: health,
      tradingWallet: { configured: true, address: ADDRESS },
      binanceWeb3Api: { configured: true, summary: { count: 0, ok: 0, failed: 0, latencyMs: { p50: null, p95: null, max: null } }, calls: [] },
      marketStatus: {},
      scheduler: { running: true, tickInFlight: false, skippedTicks: 0, lastSkippedAt: null },
      walletBalances: { status: "unavailable", reason: "not read in this test", readAt: "t" },
    },
  };

  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const render = async (file: string, name: string, props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement((await import(file))[name], props));

  return {
    opportunities,
    ledger,
    reading,
    mode,
    setLiveError,
    html: {
      spread: await render("../components/pool-spread-monitor", "PoolSpreadMonitor"),
      gate: await render("../components/guardrail-checklist", "GuardrailChecklist"),
      ledger: await render("../components/audit-ledger", "AuditLedger"),
      header: await render("../components/header", "Header", { publicReadOnly: true }),
      landing: await render("../components/landing-live-reading", "LandingLiveReading", { initial: reading, renderedAt: Date.parse(reading.at) + 5_000 }),
    },
  };
}

beforeEach(() => {
  world.send.mockClear();
});

describe("a clearly positive net edge on the public read-only build (1% pool 2% above the 0.25% pool)", () => {
  let s: Scenario;
  beforeAll(async () => {
    s = await run(510);
  }, 180_000);

  it("builds one order, runs all six guardrails on it, and stops at 'simulated': nothing is sent and the wallet is never reached", () => {
    const orders = s.ledger.entries.filter((e: any) => e.kind === "pipeline");
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order).toMatchObject({ mode: "simulation", outcome: "simulated" });
    expect(order.verdict).toMatchObject({ approved: true, status: "approved" });
    expect(order.verdict.input).toMatchObject({ ticker: "MSFT", side: "buy", sizeUsd: 200 });
    expect(order.verdict.input.adjustedSpread).toBeGreaterThan(0.005);
    expect(order.verdict.checks.map((c: any) => c.name)).toEqual(["sanityAndLiquidity", "marketStatus", "referencePrice", "perTradeCap", "dailyCap", "dryRunFloor"]);
    // Five ran and passed; the dry-run floor is pending (no simulation exists), never a pass.
    expect(order.verdict.checks.filter((c: any) => c.ok && !c.pending)).toHaveLength(5);
    expect(order.verdict.checks.find((c: any) => c.name === "dryRunFloor")).toMatchObject({ pending: true });
    // The ten ticks before it were "warming up", not orders.
    expect(s.ledger.entries.filter((e: any) => e.kind === "detection" && e.outcome === "warming_up")).toHaveLength(10);
    // Nothing in the ledger was executed, sent or approved for sending.
    for (const e of s.ledger.entries) {
      expect(e.outcome).not.toBe("executed");
      expect(e).not.toHaveProperty("send");
      expect(e).not.toHaveProperty("approval");
      expect(e).not.toHaveProperty("transactionSimulation");
    }
    expect(world.send).not.toHaveBeenCalled();
  });

  it("the server stays in simulation, refuses 'live', and the wallet's send() refuses on its own", async () => {
    expect(s.mode).toBe("simulation");
    expect((s.setLiveError as Error).name).toBe("ReadOnlyModeError");
    const real = await vi.importActual<typeof import("../lib/execution/agentic-wallet")>("../lib/execution/agentic-wallet");
    await expect(real.send({ to: ADDRESS, data: "0x", value: "0" } as never)).rejects.toThrow(/PUBLIC_READ_ONLY/);
  });

  it("the live preview agrees: the same order, passed, with the same net edge", () => {
    const [opportunity] = s.opportunities.opportunities;
    expect(opportunity.verdict.approved).toBe(true);
    expect(opportunity.order).toMatchObject({ side: "buy", sizeUsd: 200 });
    expect(opportunity.order.adjustedSpread).toBeCloseTo(s.ledger.entries.find((e: any) => e.kind === "pipeline").verdict.input.adjustedSpread, 3);
  });

  it("the spread monitor shows the positive net edge, says it clears the threshold, and says nothing is sent", () => {
    const net = (s.opportunities.history.MSFT.points.at(-1).adjustedSpread * 100).toFixed(3);
    const t = text(s.html.spread);
    expect(Number(net)).toBeGreaterThan(0.5);
    expect(t).toContain(`Net edge after costs +${net}%`);
    expect(t).toContain("clears threshold");
    expect(t).toContain("Nothing is sent: this build only simulates.");
    expect(s.html.spread).toMatch(/metric-value--pos/);
    // The cost table adds up to the same figure and states the real rule (0.01%, not "zero").
    expect(t).toContain(`Net edge = gross gap + costs +${net}%`);
    expect(t).toContain("An order is built only when the net edge is above 0.01%.");
    expect(t).not.toContain("above zero");
  });

  it("the Guardrail Gate says 'passed · not sent', in a neutral tone, with the floor pending and nothing failed", () => {
    const t = text(s.html.gate);
    expect(t).toContain("GUARDRAILS PASSED · NOT SENT");
    expect(s.html.gate).toContain("badge--not-sent");
    expect(s.html.gate).not.toContain("badge--approved");
    expect(t).toContain("preview only, nothing is sent");
    expect(t).toContain("[PENDING]");
    expect(t.match(/\[PASS\]/g)).toHaveLength(5);
    expect(t).not.toContain("[FAIL]");
    expect(t).not.toMatch(/APPROVED/);
  });

  it("the Advisory Feed line reports the edge and says nothing is sent, without contradicting itself", () => {
    const t = text(s.html.spread);
    expect(t).toMatch(/\[opportunity\] MSFT: \d\.\d\d% net spread after fees\/slippage\/gas, a real net edge survives costs, proposed size \$200 — guardrails passed \(size \$200\), but nothing is sent: this demo never sends a trade\./);
    expect(t).not.toContain("no meaningful net edge");
    // The opportunity line comes first, then the feed's own observations (largest gap in the hour, market status).
    expect(t).toContain("Advisory Feed · 3 lines");
    expect(t).toContain("At least one reading cleared costs.");
  });

  it("the Audit Ledger row is the order, labelled simulated and not sent, with the detected edge and the reason", () => {
    const t = text(s.html.ledger);
    expect(t).toContain("mode=simulation · outcome=simulated");
    expect(t).toContain("MSFT $200 — guardrails passed · not sent");
    expect(t).toContain("simulation mode: the guardrails ran on this order; no swap was simulated or sent");
    expect(t).toMatch(/detected: .* net edge \+0\.\d{3}%/);
    expect(t).toContain("outcome=warming_up");
    expect(t).not.toMatch(/outcome=executed|APPROVED|tx: |send failed/);
  });

  it("the header says public and read-only, simulation is the active mode, and Live is locked", () => {
    const t = text(s.html.header);
    expect(t).toContain("Public demo: read-only");
    const buttons = [...s.html.header.matchAll(/<button[^>]*killswitch-button[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toMatch(/killswitch-button--active/);
    expect(buttons[0]).toMatch(/aria-pressed="true"/);
    expect(text(buttons[0]!).trim()).toBe("simulation");
    expect(buttons[1]).toMatch(/aria-pressed="false"/);
    expect(s.html.header).toMatch(/killswitch-button--live[^>]*disabled/);
  });

  it("the landing page's live reading shows the positive edge in green and says nothing is ever sent", () => {
    const t = text(s.html.landing);
    expect(t).toMatch(/Net edge \+0\.\d{3}%/);
    expect(s.html.landing).toMatch(/mono pos/);
    expect(t).toContain("Above the 0.01% threshold: the guardrails decide next. On this demo nothing is ever sent.");
  });
});

describe("a positive edge too small to protect on-chain (above 0.01%, below the 0.05% swap tolerance)", () => {
  // The 1% pool 1.36% above the 0.25% pool: net about +0.03%.
  it("an order is built and passes the checks, then stops as 'tolerance_exceeds_edge': nothing sent, and the words say so", { timeout: 180_000 }, async () => {
    const s = await run(500 * 1.0136);
    const order = s.ledger.entries.find((e: any) => e.kind === "pipeline");
    const net = order.verdict.input.adjustedSpread;
    expect(net).toBeGreaterThan(0.0001);
    expect(net).toBeLessThan(0.0005);
    expect(order).toMatchObject({ mode: "simulation", outcome: "tolerance_exceeds_edge" });
    expect(world.send).not.toHaveBeenCalled();

    const ledger = text(s.html.ledger);
    expect(ledger).toContain("outcome=tolerance_exceeds_edge");
    expect(ledger).toContain("guardrails passed · not sent");
    expect(ledger).toContain("on-chain slippage tolerance isn't below the net edge");
    expect(ledger).toContain("nothing sent");
    expect(text(s.html.spread)).toContain("a small positive net edge remains after costs, too small to protect on-chain");
    expect(text(s.html.spread)).not.toContain("no meaningful net edge");
  });
});

describe("a positive edge at or under the 0.01% threshold", () => {
  // The 1% pool 1.3334% above the 0.25% pool: net about +0.005%.
  it("no order is built; the reading is recorded as 'no opportunity', and the number is not drawn as a loss", { timeout: 180_000 }, async () => {
    const s = await run(500 * 1.013334);
    const latest = s.opportunities.history.MSFT.points.at(-1).adjustedSpread;
    expect(latest).toBeGreaterThan(0);
    expect(latest).toBeLessThanOrEqual(0.0001);
    expect(s.ledger.entries.filter((e: any) => e.kind === "pipeline")).toHaveLength(0);
    expect(s.opportunities.opportunities).toHaveLength(0);
    expect(world.send).not.toHaveBeenCalled();

    const t = text(s.html.spread);
    expect(t).toMatch(/Net edge after costs \+0\.00\d%/);
    expect(t).toContain("under the 0.01% threshold");
    expect(s.html.spread).not.toMatch(/metric-value--neg/);
    expect(t).not.toContain("clears threshold");
    expect(t).not.toContain("Nothing is sent: this build only simulates.");
    expect(text(s.html.landing)).toContain('Positive, but not above the 0.01% threshold: Basis records "no opportunity" and sends nothing.');
  });
});
