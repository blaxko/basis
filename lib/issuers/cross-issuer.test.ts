import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MSFT_ISSUER_TOKENS,
  impliedMultiplier,
  confirmTokens,
  buildReading,
  CrossIssuerRecorder,
  MAX_READINGS,
  type RwaPriceRow,
} from "./cross-issuer";

// REAL /rwa/price row for MSFTB, 2026-09-25 12:06:19 UTC (docs/devex-log.md).
const REAL_MSFTB_RWA: RwaPriceRow = {
  tokenContractAddress: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0",
  platformId: "bstock",
  tokenPrice: "497.09000000",
  referencePrice: "496.437698",
};

const [MSFTB, MSFTX, MSFTON] = MSFT_ISSUER_TOKENS;

describe("normalisation to per-share prices", () => {
  it("Binance's implied multiplier for MSFTB matches the one bStocks publishes", () => {
    // Binance docs: referencePrice = tokenPrice ÷ sharesMultiplier
    const m = impliedMultiplier(Number(REAL_MSFTB_RWA.tokenPrice), Number(REAL_MSFTB_RWA.referencePrice));
    expect(m).toBeCloseTo(1.0013139, 6);
    expect(Math.abs(m / MSFTB!.publishedMultiplier - 1)).toBeLessThan(0.0005);
  });

  it("per-share price = token price ÷ multiplier", () => {
    const r = buildReading({
      t: 0,
      tokens: [
        { token: MSFTB!, multiplier: 1.001314, buyPerToken: 519.2, sellPerToken: 517.9, sellAgeS: 30 },
        { token: MSFTX!, multiplier: 1.005903, buyPerToken: 522.5, sellPerToken: 520.0, sellAgeS: 30 },
      ],
      gasUsd: 0.024,
      sizeUsd: 200,
    });
    expect(r.tokens[0]!.buyPerShare).toBeCloseTo(519.2 / 1.001314, 6);
    expect(r.tokens[1]!.buyPerShare).toBeCloseTo(522.5 / 1.005903, 6);
  });
});

describe("a token is used only when Binance's RWA API confirms it", () => {
  it("platform must match the issuer; multiplier must match the issuer-published one", () => {
    const rows: RwaPriceRow[] = [
      REAL_MSFTB_RWA,
      { tokenContractAddress: MSFTX!.address, platformId: "ondo", tokenPrice: "522", referencePrice: "519" }, // wrong platform
      // MSFTon: not returned at all
    ];
    const c = confirmTokens(MSFT_ISSUER_TOKENS, rows);
    expect(c.find((x) => x.symbol === "MSFTB")).toMatchObject({ included: true, platformId: "bstock", multiplierMatches: true });
    expect(c.find((x) => x.symbol === "MSFTx")).toMatchObject({ included: false });
    expect(c.find((x) => x.symbol === "MSFTx")!.reason).toMatch(/platform/);
    expect(c.find((x) => x.symbol === "MSFTon")).toMatchObject({ included: false });
    expect(c.find((x) => x.symbol === "MSFTon")!.reason).toMatch(/not returned/);
  });

  it("a multiplier that disagrees with the issuer by more than 0.05% excludes the token", () => {
    const rows: RwaPriceRow[] = [{ ...REAL_MSFTB_RWA, referencePrice: "490" }]; // implies 1.0145
    const c = confirmTokens([MSFTB!], rows);
    expect(c[0]).toMatchObject({ included: false, multiplierMatches: false });
  });
});

describe("gaps and round-trip costs", () => {
  it("reports the per-share gap and whether buy-cheap / sell-dear clears the quotes' costs and gas", () => {
    const r = buildReading({
      t: 0,
      tokens: [
        { token: MSFTB!, multiplier: 1, buyPerToken: 500, sellPerToken: 499, sellAgeS: 60 },
        { token: MSFTX!, multiplier: 1, buyPerToken: 510, sellPerToken: 508, sellAgeS: 60 },
      ],
      gasUsd: 0.2,
      sizeUsd: 200,
    });
    expect(r.gap).toMatchObject({ cheapest: "MSFTB", dearest: "MSFTx" });
    expect(r.gap!.grossPct).toBeCloseTo(0.02, 6);
    // buy MSFTB at 500/share, sell MSFTx at 508/share, minus $0.2 gas on $200
    expect(r.roundTrip).toMatchObject({ buy: "MSFTB", sell: "MSFTx" });
    expect(r.roundTrip!.netPct).toBeCloseTo(0.016 - 0.001, 6);
    expect(r.roundTrip!.clears).toBe(true);
  });

  it("with fewer than two priced tokens there is no gap, and nothing is invented", () => {
    const r = buildReading({ t: 0, tokens: [{ token: MSFTB!, multiplier: 1, buyPerToken: 500 }, { token: MSFTON!, multiplier: 1, error: "code 40367: market closed" }], gasUsd: 0.02, sizeUsd: 200 });
    expect(r.gap).toBeNull();
    expect(r.roundTrip).toBeNull();
    expect(r.tokens[1]).toMatchObject({ symbol: "MSFTon", error: "code 40367: market closed" });
  });
});

describe("the recorder: modest calls, bounded memory, never trades", () => {
  function recorder() {
    const calls: string[] = [];
    const request = vi.fn(async ({ path, query }: { path: string; query: URLSearchParams }) => {
      calls.push(path);
      if (path.endsWith("/rwa/price")) {
        return {
          httpStatus: 200,
          body: {
            code: 0,
            data: [
              REAL_MSFTB_RWA,
              { tokenContractAddress: MSFTX!.address, platformId: "xstock", tokenPrice: "525.0", referencePrice: String(525 / MSFTX!.publishedMultiplier) },
              { tokenContractAddress: MSFTON!.address, platformId: "ondo", tokenPrice: "523.0", referencePrice: String(523 / MSFTON!.publishedMultiplier) },
            ],
          },
          text: "",
          latencyMs: 1,
        };
      }
      // aggregator quote: 200 USDT -> ~0.38 token, or tokens -> USDT
      const fromUsdt = query.get("fromTokenAddress")!.toLowerCase() === "0x55d398326f99059ff775485246999027b3197955";
      const amountIn = Number(query.get("amount")) / 1e18;
      const out = fromUsdt ? amountIn / 520 : amountIn * 518;
      return { httpStatus: 200, body: { code: 0, data: [{ isBest: true, vendorName: "LiquidMesh", toTokenAmount: String(BigInt(Math.round(out * 1e12)) * 1_000_000n), toToken: { decimal: "18" }, dexRouterList: [] }] }, text: "", latencyMs: 1 };
    });
    const rec = new CrossIssuerRecorder({
      request: request as never,
      latestMsftbBuy: () => ({ priceUsdPerToken: 519.5, at: 0 }),
      latestGasUsd: () => 0.024,
      now: () => 0,
      sleep: async () => {},
      log: () => {},
      userWalletAddress: "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95",
    });
    return { rec, calls };
  }

  it("first tick confirms tokens (1 call), sells (3) and buys the two non-bStocks tokens (2); later ticks only buy (2)", async () => {
    const { rec, calls } = recorder();
    await rec.tick();
    expect(calls.filter((p) => p.endsWith("/rwa/price"))).toHaveLength(1);
    expect(calls.filter((p) => p.endsWith("/aggregator/quote"))).toHaveLength(5);
    calls.length = 0;
    await rec.tick();
    expect(calls).toHaveLength(2); // MSFTB reuses the scheduler's own quote
    const confirmed = rec.status().tokens.filter((t) => t.included).map((t) => t.symbol);
    expect(confirmed).toEqual(["MSFTB", "MSFTx", "MSFTon"]);
  });

  it("over 10 ticks (5 min) it makes at most 2×10 + 4 = 24 calls: about 4.8 a minute", async () => {
    const { rec, calls } = recorder();
    for (let i = 0; i < 10; i++) await rec.tick();
    expect(calls.length).toBeLessThanOrEqual(24);
    expect(rec.status().callsPerMinuteBudget).toBeCloseTo(4.8, 1);
  });

  it("keeps at most 24 h of readings", async () => {
    const { rec } = recorder();
    for (let i = 0; i < MAX_READINGS + 5; i++) await rec.tick();
    expect(rec.readings()).toHaveLength(MAX_READINGS);
  });

  it("imports nothing that can sign or send", () => {
    const src = readFileSync(join(__dirname, "cross-issuer.ts"), "utf8");
    expect(src).not.toMatch(/agentic-wallet|pipeline|binance-transaction|execution-test|killswitch/);
  });
});

describe("implausible quotes never become prices (live, 2026-09-27: MSFTon read as ~$1.03 billion per token)", () => {
  it("a per-share buy more than 20% from bStocks' is an error with its raw quote kept, and there's no gap", async () => {
    const request = vi.fn(async ({ path, query }: { path: string; query: URLSearchParams }) => {
      if (path.endsWith("/rwa/price")) {
        return {
          httpStatus: 200,
          body: { code: 0, data: [REAL_MSFTB_RWA, { tokenContractAddress: MSFTON!.address, platformId: "ondo", tokenPrice: "523.0", referencePrice: String(523 / MSFTON!.publishedMultiplier) }] },
          text: "",
          latencyMs: 1,
        };
      }
      const toOndo = query.get("toTokenAddress")!.toLowerCase() === MSFTON!.address;
      // An amount that implies ~$1e9 per token, as observed live.
      const route = { isBest: true, vendorName: "PcsXRfq", executionMode: "RFQ", fromTokenAmount: query.get("amount"), toTokenAmount: toOndo ? "194110000000" : "385000000000000000", toToken: { decimal: "18", tokenSymbol: toOndo ? "MSFTon" : "USDT", tokenUnitPrice: "523.1" } };
      return { httpStatus: 200, body: { code: 0, data: [route] }, text: "", latencyMs: 1 };
    });
    const rec = new CrossIssuerRecorder({
      request: request as never,
      latestMsftbBuy: () => ({ priceUsdPerToken: 519.5, at: 0 }),
      latestGasUsd: () => 0.024,
      now: () => 0,
      sleep: async () => {},
      log: () => {},
    });
    const r = (await rec.tick())!;
    const ondo = r.tokens.find((t) => t.symbol === "MSFTon")!;
    expect(ondo.buyPerShare).toBeNull();
    expect(ondo.error).toMatch(/implausible/);
    expect(r.gap).toBeNull();
    const raw = rec.status().lastQuotes.MSFTon_buy;
    expect(raw).toMatchObject({ vendorName: "PcsXRfq", executionMode: "RFQ", toTokenAmount: "194110000000", toTokenDecimal: "18", toTokenSymbol: "MSFTon", toTokenUnitPrice: "523.1" });
  });

  it("says plainly when Binance returns a token without a platformId", () => {
    const c = confirmTokens([MSFTX!], [{ tokenContractAddress: MSFTX!.address, tokenPrice: "525", referencePrice: "522" }]);
    expect(c[0]!.reason).toBe("Binance's RWA API returned it without a platformId, so it can't be confirmed as xStocks");
    expect(c[0]!.binanceRow).toMatchObject({ tokenContractAddress: MSFTX!.address });
  });
});

describe("GET /api/issuers", () => {
  it("returns status and readings, labelled monitor-only, with no URL", async () => {
    vi.resetModules();
    const { GET } = await import("../../app/api/issuers/route");
    const body = await (await GET(new Request("http://localhost/api/issuers"))).json();
    expect(body.label).toBe("Monitor only: Basis doesn't trade across issuers");
    expect(Array.isArray(body.readings)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
  });
});
