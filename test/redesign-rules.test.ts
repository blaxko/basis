import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The redesign took the reference files' visual language only, never their
// example content. These rules keep made-up decoration and false claims
// off the page.

const ROOT = join(__dirname, "..");
const uiFiles = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? uiFiles(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [join(dir, e.name)] : []
  );
const ui = [...uiFiles("app").filter((f) => !f.includes(join("app", "api"))), ...uiFiles("components")].map((f) => ({ f, src: readFileSync(join(ROOT, f), "utf8") }));

describe("no fake decoration or false claims from the reference files", () => {
  it.each([
    ["institutional", /institutional/i],
    ["an invented version", /\bv\d+\.\d+\b/],
    ["SYSTEM NODE", /SYSTEM NODE/i],
    ["LATENCY OPT", /LATENCY OPT/i],
    ["a user avatar", /avatar/i],
    ["Reset Session", /Reset Session/i],
    ["a 10-second interval", /\b10\s?s\b|every 10s|10,000ms/i],
    ["'smart contracts decide'", /smart contracts? decide/i],
    ["'Binance oracle'", /Binance oracle/i],
    ["'both trade directions'", /both (trade )?directions/i],
    ["'Engine: PancakeSwap V3 QuoterV2'", /Engine:\s*PancakeSwap/i],
    ["'regular trading hours'", /regular trading hours/i],
  ])("%s appears nowhere in the UI", (_label, pattern) => {
    const hits = ui.filter(({ src }) => pattern.test(src)).map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it("the market-status row describes the real rule: MARKET_CLOSED also passes", () => {
    const gate = readFileSync(join(ROOT, "components", "guardrail-checklist.tsx"), "utf8");
    expect(gate).toMatch(/Passes on TRADING and on MARKET_CLOSED/);
  });

  it("the monitor says what detection reads and that it picks one direction per reading", () => {
    const monitor = readFileSync(join(ROOT, "components", "pool-spread-monitor.tsx"), "utf8");
    expect(monitor).toContain("PancakeSwap V3 slot0");
    expect(monitor).toContain("the direction is picked on each reading");
  });
});

describe("sidebar", () => {
  it("every link jumps to a panel that exists on the page", () => {
    const nav = readFileSync(join(ROOT, "components", "sidebar-nav.tsx"), "utf8");
    const hrefs = [...nav.matchAll(/href: "#([a-z-]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(3);
    const all = ui.map(({ src }) => src).join("\n");
    for (const id of hrefs) expect(all, `#${id}`).toMatch(new RegExp(`id="${id}"`));
  });
});

describe("instruction examples", () => {
  it("include the Sell example, which the server refuses", () => {
    const box = readFileSync(join(ROOT, "components", "instruction-box.tsx"), "utf8");
    expect(box).toContain('"Sell $50 of MSFT"');
  });
});

describe("motion", () => {
  it("respects prefers-reduced-motion and has no pulsing animation", () => {
    const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/@keyframes|animation:(?!\s*none)/);
  });
});
