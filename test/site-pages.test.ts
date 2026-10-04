import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAGES, HOW, GUARDRAILS, FINDINGS, FAQ_PAGE, FINDING_FACTS, type PageKey } from "../components/site-content";
import { LANDING, GITHUB_URL } from "../components/landing-content";
import { SITE_PAGES, DASHBOARD_SECTIONS } from "../components/site-sections";
import { pageMetadata } from "../components/page-metadata";
import { workedExample } from "../components/worked-example";
import { DEFAULT_GUARDRAIL_CONFIG } from "../lib/guardrails/config";
import { MARKET_STATUS_PASS_CODES, MARKET_STATUS_BLOCK_CODES } from "../lib/guardrails/check";
import type { LiveReading } from "../components/api-types";

// The landing page's menu items are real pages (/how-it-works, /guardrails,
// /findings, /faq) that share the landing page's layout and glass style.
// Each is the fuller version of its topic, from facts already in the repo.

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const KEYS: PageKey[] = ["how-it-works", "guardrails", "findings", "faq"];
const SITE_DIR = "app/(site)";

// Every string the four pages show.
const pagesText = JSON.stringify({ HOW, GUARDRAILS, FINDINGS, FAQ_PAGE, PAGES });
const pageSources = [...KEYS.map((k) => read(`${SITE_DIR}/${k}/page.tsx`)), read("components/site-page-parts.tsx"), read("components/worked-example.tsx"), read("components/site-content.ts")].join("\n");

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

describe("routes and the shared layout", () => {
  it("the landing page and the four pages share one layout (header, footer, glass, motion); the dashboard is outside it", () => {
    expect(existsSync(join(ROOT, SITE_DIR, "layout.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, SITE_DIR, "page.tsx"))).toBe(true);
    for (const k of KEYS) expect(existsSync(join(ROOT, SITE_DIR, k, "page.tsx")), k).toBe(true);
    expect(existsSync(join(ROOT, "app", "page.tsx"))).toBe(false);
    const layout = read(`${SITE_DIR}/layout.tsx`);
    for (const part of ["<SiteHeader />", "<SiteFooter />", "<PageBackdrop />", "<LandingMotion />", "MOTION_BOOT", `import "../landing.css";`]) expect(layout, part).toContain(part);
    // The dashboard keeps its own header and styles.
    expect(read("app/dashboard/page.tsx")).not.toMatch(/SiteHeader|SiteFooter|landing\.css/);
  });

  it("the header is the landing page's: wordmark home, theme toggle, menu, 'Open the dashboard'", () => {
    const header = read("components/site-header.tsx");
    expect(header).toContain('href="/"');
    expect(header).toContain("<ThemeToggle />");
    expect(header).toContain("<SiteMenu sections={SITE_PAGES}");
    expect(header).toContain("LANDING.hero.primary.label");
    expect(header).toContain("LANDING.hero.primary.href");
    expect(LANDING.hero.primary.label).toBe("Open the dashboard");
    expect(LANDING.hero.primary.href).toBe("/app");
  });

  it("the footer is only 'Basis · Built on BNB Chain', on every page", () => {
    const footer = read("components/site-footer.tsx");
    expect(footer).toContain("{LANDING.footer.name}");
    expect(footer).not.toMatch(/href=|financial advice/i);
    expect(LANDING.footer).toEqual({ name: "Basis · Built on BNB Chain" });
    for (const k of KEYS) expect(read(`${SITE_DIR}/${k}/page.tsx`), k).not.toMatch(/<footer|<header/);
  });

  it("the landing page no longer carries its own header or footer, and its sections link to their pages", () => {
    const landing = read(`${SITE_DIR}/page.tsx`);
    expect(landing).not.toMatch(/<header|<footer|SiteMenu|ThemeToggle/);
    const links = [...landing.matchAll(/<ReadMore href="([^"]+)"/g)].map((m) => m[1]);
    for (const path of ["/how-it-works", "/guardrails", "/findings", "/faq"]) expect(links, path).toContain(path);
    expect(links.every((l) => l!.startsWith("/"))).toBe(true);
  });
});

describe("the menu opens the pages", () => {
  it("How it works · Guardrails · Findings · FAQ are internal pages; GitHub is the repo, external", () => {
    expect(SITE_PAGES.map((p) => [p.label, p.href])).toEqual([
      ["How it works", "/how-it-works"],
      ["Guardrails", "/guardrails"],
      ["Findings", "/findings"],
      ["FAQ", "/faq"],
      ["GitHub", GITHUB_URL],
    ]);
    expect(SITE_PAGES.filter((p) => p.external).map((p) => p.label)).toEqual(["GitHub"]);
    expect(GITHUB_URL).toBe("https://github.com/blaxko/basis");
    // The menu and the page metadata agree on the paths.
    for (const k of KEYS) expect(SITE_PAGES.find((p) => p.href === PAGES[k].path)?.label, k).toBe(PAGES[k].menu);
  });

  it("marks the current page, opens GitHub in a new tab and says so, and the dashboard menu is unchanged", () => {
    const menu = read("components/site-menu.tsx");
    expect(menu).toContain("usePathname");
    expect(menu).toContain('aria-current={active ? "page" : undefined}');
    expect(menu).toContain('target: "_blank"');
    expect(menu).toContain('rel: "noopener noreferrer"');
    expect(menu).toContain("(opens in a new tab)");
    expect(DASHBOARD_SECTIONS.map((s) => [s.label, s.href])).toEqual([
      ["Live spread", "#spread"],
      ["Instruction", "#instruction"],
      ["Guardrails", "#gate"],
      ["Ledger", "#ledger"],
      ["Issuers", "#issuers"],
    ]);
    expect(DASHBOARD_SECTIONS.some((s) => s.external)).toBe(false);
  });
});

describe("each page has its own title and description", () => {
  it("unique, specific, and short enough for search results and link previews", () => {
    const titles = KEYS.map((k) => PAGES[k].title);
    const descs = KEYS.map((k) => PAGES[k].description);
    expect(new Set(titles).size).toBe(4);
    expect(new Set(descs).size).toBe(4);
    for (const k of KEYS) {
      expect(PAGES[k].title.length, k).toBeLessThanOrEqual(60);
      expect(PAGES[k].title, k).toMatch(/· Basis$/);
      expect(PAGES[k].description.length, k).toBeGreaterThanOrEqual(80);
      expect(PAGES[k].description.length, k).toBeLessThanOrEqual(160);
    }
  });

  it("each page exports it (with a canonical path and a link preview), and the root layout sets the site's base URL", () => {
    for (const k of KEYS) {
      expect(read(`${SITE_DIR}/${k}/page.tsx`), k).toContain(`export const metadata = pageMetadata("${k}");`);
      const m = pageMetadata(k);
      expect(m.title).toBe(PAGES[k].title);
      expect(m.description).toBe(PAGES[k].description);
      expect(m.alternates?.canonical).toBe(PAGES[k].path);
      expect(m.openGraph).toMatchObject({ title: PAGES[k].title, description: PAGES[k].description, url: PAGES[k].path, siteName: "Basis" });
    }
    expect(read("app/layout.tsx")).toContain("metadataBase: new URL(SITE_URL)");
    // In the <head> for every client, including on the dynamic pages (not streamed after it).
    const config = read("next.config.ts");
    expect(config).toContain("htmlLimitedBots: /.*/,");
  });
});

describe("content rules", () => {
  it.each([
    "revolutionary", "game-changing", "cutting-edge", "seamless", "unlock", "unleash", "empower", "supercharge", "next-generation",
    "state-of-the-art", "harness", "elevate", "effortless", "the future of", "official", "partner", "institutional", "AI-powered",
    "guaranteed", "risk-free", "profitable", "earn",
  ])("never says %s", (word) => {
    expect(pagesText + pageSources).not.toMatch(new RegExp(`\\b${word}`, "i"));
  });

  it("no hackathon, test trade, transactions, trading wallet, logos, emoji or exclamation marks", () => {
    expect(pagesText + pageSources).not.toMatch(/hackathon|BNB Hack/i);
    expect(pagesText + pageSources).not.toMatch(/\$5\b|test trade|execution test|bscscan|0x[0-9a-fA-F]{40}|trading wallet|wallet address/i);
    expect(pageSources).not.toMatch(/<img|<Image|\.svg["']|\.png["']|logo/i);
    expect(pagesText + pageSources).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(pagesText).not.toContain("!");
  });

  it("scannable: headings are short claims, and no paragraph runs past 60 words", () => {
    const headings: string[] = [HOW.title, GUARDRAILS.title, FINDINGS.title, FAQ_PAGE.title, ...HOW.steps.map((s) => s.title), ...GUARDRAILS.checks.map((c) => c.title), ...FINDINGS.findings.map((f) => f.title), ...FAQ_PAGE.groups.map((g) => g.title)];
    for (const h of headings) expect(words(h), h).toBeLessThanOrEqual(12);
    for (const s of strings({ HOW, GUARDRAILS, FINDINGS, FAQ_PAGE })) expect(words(s), s.slice(0, 40)).toBeLessThanOrEqual(60);
  });

  it("server-rendered, with no JavaScript of their own: none of the four pages or their parts is a client component", () => {
    for (const f of [...KEYS.map((k) => `${SITE_DIR}/${k}/page.tsx`), "components/site-page-parts.tsx", "components/worked-example.tsx", "components/site-content.ts", "components/page-metadata.ts"]) {
      expect(read(f), f).not.toMatch(/["']use client["']/);
    }
    // Their imports are server-only parts: no client component, no chart.
    for (const k of KEYS) expect(read(`${SITE_DIR}/${k}/page.tsx`), k).not.toMatch(/landing-live-reading|spread-chart|site-menu|theme-toggle|use-poll/);
  });
});

describe("Guardrails page: every limit is the config's", () => {
  const byTitle = (re: RegExp) => GUARDRAILS.checks.find((c) => re.test(c.name))!;
  const c = DEFAULT_GUARDRAIL_CONFIG;
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

  it("six checks, each with what it measures, its limit and what happens when it fails", () => {
    expect(GUARDRAILS.checks.map((x) => x.name)).toEqual(["Per-trade cap", "Daily cap", "Reference price", "Market status", "Price sanity and liquidity", "Dry-run floor"]);
    for (const x of GUARDRAILS.checks) {
      expect(x.measures.length, x.name).toBeGreaterThan(20);
      expect(x.limit.length, x.name).toBeGreaterThan(5);
      expect(x.fails.length, x.name).toBeGreaterThan(20);
    }
  });

  it("the numbers equal lib/guardrails/config.ts", () => {
    expect(byTitle(/Per-trade/).limit).toContain(`${usd(c.perTradeCapUsd)} per trade`);
    expect(byTitle(/Daily/).limit).toContain(`${usd(c.perDayCapUsd)} per UTC day`);
    expect(byTitle(/Reference/).limit).toContain(`within ${c.maxReferenceDivergencePct * 100}%`);
    expect(byTitle(/Dry-run/).limit).toContain(`${c.minDryRunOutputRatio * 100}%`);
    const sanity = byTitle(/sanity/).limit;
    expect(sanity).toContain(`within ${c.maxPriceDeviationPct * 100}%`);
    expect(sanity).toContain(`at least ${usd(c.minLiquidityDepthUsd)}`);
    expect(sanity).toContain(`${c.minPriceHistoryReadings} readings`);
    expect(byTitle(/sanity/).fails).toContain(`fewer than ${c.minPriceHistoryReadings} readings`);
    const more = JSON.stringify(GUARDRAILS.more);
    expect(more).toContain(`${c.minSpreadRetentionRatio * 100}%`.replace("50%", "half"));
    expect(more).toContain(`${c.sendSlippageTolerance * 100}%`);
  });

  it("market status lists exactly the codes the check passes and blocks on", () => {
    const m = byTitle(/Market status/).limit;
    for (const code of [...MARKET_STATUS_PASS_CODES, ...MARKET_STATUS_BLOCK_CODES]) expect(m, code).toContain(code);
    expect(byTitle(/Market status/).fails).toMatch(/can't be fetched|unrecognised/);
  });
});

describe("Findings page: real data, with its period, how it was measured and why it led to rejection", () => {
  it("every finding has a data period, a method, what it showed and why", () => {
    expect(FINDINGS.findings.map((f) => f.period)).toEqual([FINDING_FACTS.roundTrips.period, "20 Aug 2026", "18–21 Sep 2026", "25 Sep 2026", "25–30 Sep 2026"]);
    for (const f of FINDINGS.findings) {
      for (const field of [f.period, f.measured, f.showed, f.why]) expect(field.length, f.title).toBeGreaterThan(10);
    }
  });

  it("the recounted round trips (196 fresh, none cleared) and the data quality, dated", () => {
    // Recounted from the recorder's export on 2026-10-03 23:58 UTC.
    expect(FINDING_FACTS.roundTrips).toMatchObject({ count: 196, cleared: 0, best: "−0.013%", median: "−0.21%", period: "26–30 Sep and 2–3 Oct 2026" });
    expect(FINDING_FACTS.readings).toMatchObject({ total: 12479, valid: 7197, asOf: "3 Oct 2026, 23:58 UTC" });
    expect(FINDINGS.findings[0]!.title).toBe("196 fresh round trips between bStocks and Ondo: none cleared costs");
    expect(FINDINGS.findings[0]!.measured).toMatch(/at most 60 seconds/);
    expect(JSON.stringify(FINDINGS.findings[0])).toContain("30 Sep 05:48");
    expect(JSON.stringify(FINDINGS.findings[0])).toContain("2 Oct 22:52");
  });

  it("the landing page's round-trip card is the same recount", () => {
    const card = LANDING.findings.cards[0]!;
    expect(card.title).toBe(FINDINGS.findings[0]!.title);
    expect(card.period).toBe(FINDING_FACTS.roundTrips.period);
    expect(card.body).toContain(FINDING_FACTS.roundTrips.best);
  });

  it("dividend timing and weekend gaps are described as the PRD records them", () => {
    const [, dividend, weekend] = FINDINGS.findings;
    expect(dividend!.title).toBe("Dividend timing: tested with real prices, rejected");
    expect(dividend!.showed).toMatch(/same direction/);
    expect(weekend!.title).toBe("Weekend gaps: tested with real prices, rejected");
    expect(weekend!.showed).toMatch(/no gap and no freeze/);
    const prd = read("docs/PRD.md");
    expect(prd).toContain("2026-08-20 ex-dividend");
    expect(prd).toContain("Friday-to-Monday window");
  });
});

describe("How it works page", () => {
  it("three steps in detail (Read, Count, Guard), the formula, and which Binance Web3 API modules are used where", () => {
    expect(HOW.steps.map((s) => s.name)).toEqual(["Read", "Count", "Guard"]);
    expect(HOW.formula).toBe(LANDING.how.formula);
    const apis = JSON.stringify(HOW.apis);
    for (const part of ["aggregator/quote", "rwa/underlying-market", "rwa/price", "pre-transaction/simulate", "broadcast-transaction", "Trading API", "RWA Data API", "Transaction API", "Groq"]) {
      expect(apis, part).toContain(part);
    }
    // The public site never reaches the Transaction API.
    expect(HOW.apis.find((a) => /Transaction/.test(a.title))!.body).toMatch(/public site never reaches/);
  });

  it("the stated numbers are the code's: 30 s, 0.05% slippage, gas ×2, 0.01% threshold", () => {
    const text = JSON.stringify(HOW.steps);
    const loop = read("lib/orchestration/agent-loop.ts");
    expect(loop).toMatch(/slippagePctEstimate: 0\.0005/);
    expect(loop).toMatch(/gasSafetyMultiplier: 2/);
    expect(loop).toMatch(/adjustedSpreadThreshold: 0\.0001/);
    expect(read("lib/orchestration/scheduler.ts")).toMatch(/DEFAULT_SCHEDULER_INTERVAL_MS = 30[_]?000/);
    for (const part of ["30 seconds", "0.05%", "2×", "0.01%", "1.25%"]) expect(text, part).toContain(part);
  });
});

describe("the worked example, from the live reading", () => {
  // A real reading, 2026-09-28 22:56:37 UTC (the 1% pool was the cheaper one).
  const at = "2026-09-28T22:56:37.644Z";
  const reading: LiveReading = {
    at,
    tradeSizeUsd: 200,
    pools: [
      { fee: "0.25%", priceUsd: 510.7387114316477 },
      { fee: "1%", priceUsd: 509.0837624859116 },
    ],
    grossGap: 0.0032508382071641216,
    totalCost: -0.013034893329619136,
    netEdge: -0.009784055122455015,
    lines: [
      { key: "buyFee", pct: -0.009933176615912469, usd: 1.9866353231824938, feeUnits: 10000 },
      { key: "sellFee", pct: -0.0024832941539781163, usd: 0.4966588307956233, feeUnits: 2500 },
      { key: "slippage", pct: -0.0005, usd: 0.1 },
      { key: "gas", pct: -0.00011842255972855192, usd: 0.023684511945710383 },
    ],
  };
  const now = Date.parse(at) + 20_000;

  it("buys the cheaper pool, sells the dearer, and each line is the dashboard's cost line", () => {
    const w = workedExample(reading, now);
    if (w.kind !== "ok") throw new Error("expected a reading");
    expect(w.ageS).toBe(20);
    expect(w.buy).toEqual({ fee: "1%", priceUsd: 509.0837624859116 });
    expect(w.sell).toEqual({ fee: "0.25%", priceUsd: 510.7387114316477 });
    expect(w.rows.map((r) => r.label)).toEqual(["Gap between the pools", "Buy-side fee (1% pool)", "Sell-side fee (0.25% pool)", "Slippage (fixed estimate)", "Gas for both swaps"]);
    // Gap plus every cost is exactly the net edge.
    expect(w.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(reading.netEdge, 12);
    expect(w.netEdge).toBe(reading.netEdge);
    expect(w.verdict).toMatch(/Below zero/);
  });

  it("an edge above the threshold hands over to the guardrails; no reading or a stale one is unavailable, with no numbers", () => {
    const up = workedExample({ ...reading, netEdge: 0.002 }, now);
    if (up.kind !== "ok") throw new Error("expected a reading");
    expect(up.verdict).toMatch(/guardrails decide next/);
    expect(workedExample(null, now)).toEqual({ kind: "unavailable" });
    expect(workedExample(reading, Date.parse(at) + 600_000)).toEqual({ kind: "unavailable" });
  });

  it("the page renders it on the server, with its time, and says 'unavailable' otherwise", () => {
    const page = read(`${SITE_DIR}/how-it-works/page.tsx`);
    expect(page).toContain('export const dynamic = "force-dynamic";');
    expect(page).toContain('import { GET as getReading } from "../../api/reading/route";');
    expect(page).toContain("<WorkedExample reading={reading} nowMs={nowMs} />");
    const part = read("components/worked-example.tsx");
    expect(part).toContain("Live reading unavailable");
    expect(part).toMatch(/Recorded at \{.*\} UTC/);
  });
});

describe("FAQ page", () => {
  it("has every current question, in full, plus more the repo can answer", () => {
    const all = FAQ_PAGE.groups.flatMap((g) => g.items);
    for (const f of LANDING.faq) expect(all.find((x) => x.q === f.q)?.a, f.q).toBe(f.a);
    expect(all.length).toBeGreaterThanOrEqual(LANDING.faq.length + 8);
    expect(new Set(all.map((x) => x.q)).size).toBe(all.length);
  });

  it("the new answers match the code and docs", () => {
    const a = (q: RegExp) => FAQ_PAGE.groups.flatMap((g) => g.items).find((x) => q.test(x.q))!.a;
    expect(a(/Which AI/)).toContain("openai/gpt-oss-120b");
    expect(read("lib/llm/groq-client.ts")).toContain('DEFAULT_MODEL = "openai/gpt-oss-120b"');
    expect(a(/change the mode/)).toContain("5 minutes");
    expect(read("lib/orchestration/killswitch.ts")).toContain("PUBLIC_MODE_RESET_MS = 5 * 60_000");
    expect(a(/net edge/i)).toContain("0.01%");
    expect(a(/sell orders/i)).toMatch(/aren't supported/);
    expect(a(/no valid quote/i)).toMatch(/40367/);
    expect(read("docs/how-to-use.md")).toContain("code 40367");
    expect(a(/kept/i)).toMatch(/memory/);
    expect(a(/closed stock market/i)).toMatch(/paused, limited, unsupported/);
    expect(read("LICENSE")).toMatch(/^MIT License/);
    expect(a(/code/i)).toContain("MIT");
  });
});

describe("every page works at every width (styles exist for the layouts the pages use)", () => {
  it("the page styles are the landing page's, in one file loaded only by these pages", () => {
    const css = read("app/landing.css");
    for (const cls of [".l-pagehead", ".l-readmore", ".l-facts", ".l-worked", ".l-detail", ".l-closing"]) expect(css, cls).toContain(cls);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    // 44 px tap target for the small links.
    const rule = css.slice(css.indexOf(".l-readmore {"), css.indexOf("}", css.indexOf(".l-readmore {")));
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(readdirSync(join(ROOT, "app")).filter((n) => n.endsWith(".css")).sort()).toEqual(["globals.css", "landing.css"]);
  });
});
