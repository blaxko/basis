import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { issuerRows } from "../components/issuer-panel-view";

// The issuer monitor panel: /api/issuers/summary and the component.

const ROOT = join(__dirname, "..");
afterEach(() => vi.resetModules());

describe("GET /api/issuers/summary", () => {
  it("is labelled monitor-only, carries no URL, and is rate-limited", async () => {
    const { GET } = await import("../app/api/issuers/summary/route");
    const res = await GET(new Request("http://localhost/api/issuers/summary", { headers: { "x-real-ip": "203.0.113.9" } }));
    const body = await res.json();
    expect(body.label).toBe("Monitor only: Basis doesn't trade across issuers");
    expect(body).toHaveProperty("tokens");
    expect(body).toHaveProperty("lastHour");
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
    let last = res;
    for (let i = 0; i < 20; i++) last = await GET(new Request("http://localhost/api/issuers/summary", { headers: { "x-real-ip": "203.0.113.9" } }));
    expect(last.status).toBe(429);
  });
});

describe("panel rows", () => {
  it("a token with no valid quote shows the reason, never a number", () => {
    const rows = issuerRows({
      tokens: [
        { symbol: "MSFTB", issuer: "bStocks", status: "ok", multiplier: 1.0013139, publishedMultiplier: 1.0013139, buyPerShare: 512.56, sellPerShare: 509.96, sellAgeS: 150, lastValidAt: "2026-09-28T17:00:00.000Z" },
        { symbol: "MSFTon", issuer: "Ondo", status: "no_quote", multiplier: 1.0057308, publishedMultiplier: 1.0057308, buyPerShare: null, sellPerShare: null, sellAgeS: null, reason: "Binance: The stock market is currently closed. (code 40367)", lastValidAt: "2026-09-28T16:20:00.000Z" },
      ],
    });
    expect(rows[0]).toMatchObject({ buy: "$512.56", sell: "$509.96 (2 min old)", note: null });
    expect(rows[1]).toMatchObject({ buy: "no valid quote", sell: "—", note: "Binance: The stock market is currently closed. (code 40367) · last valid quote 16:20 UTC" });
    expect(JSON.stringify(rows[1])).not.toMatch(/\$\d/);
  });
});

describe("the panel", () => {
  const panel = readFileSync(join(ROOT, "components", "issuer-monitor.tsx"), "utf8");
  it("is labelled, says it compares per-share prices, and explains the costs", () => {
    expect(panel).toContain("summary.label");
    expect(panel).toMatch(/per share/i);
    expect(panel).toMatch(/sharesMultiplier|shares multiplier/);
    expect(panel).toMatch(/fees and price impact/);
    // "would clear costs" only from fresh quotes; otherwise the reason
    expect(panel).toContain("summary.freshLimitS");
    expect(panel).toContain("summary.roundTripNote");
    expect(panel).toContain('id="issuers"');
    expect(panel).toContain('"/api/issuers/summary"');
  });
  it("is on the dashboard", () => {
    expect(readFileSync(join(ROOT, "app", "dashboard", "page.tsx"), "utf8")).toContain("<IssuerMonitor />");
  });
  it("never keeps an earlier reading's price (no state beyond the poll)", () => {
    expect(panel).not.toMatch(/useState|useRef/);
  });
});
