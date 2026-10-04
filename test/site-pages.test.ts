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
import { readOnlyNote } from "../components/read-only-note";
import { ledgerVerdictWord } from "../components/verdict-wording";
import { CHECKED_UNTIL, ROUND_TRIPS_TITLE } from "../components/finding-facts";

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
// Sentences: a full stop, question or exclamation mark followed by a space (not the dot in 0.05%).
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0).length;

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

  it("the header button exposes only its visible label to screen readers: no aria-label, and the hidden variant is display:none, not aria-hidden", () => {
    const header = read("components/site-header.tsx");
    const link = header.slice(header.indexOf('<a className="btn btn--primary topbar-cta"'), header.indexOf("</a>", header.indexOf("topbar-cta")));
    expect(link).not.toMatch(/aria-label|aria-hidden|title=/);
    expect(link).toContain('<span className="cta-long">{LANDING.hero.primary.label}</span>');
    expect(link).toContain('<span className="cta-short">Dashboard</span>');
    // display:none removes the hidden label from the accessible name.
    const css = read("app/landing.css");
    expect(css).toMatch(/\.cta-short \{\n  display: none;/);
    expect(css).toMatch(/@media \(max-width: 400px\) \{\n  \.cta-long \{\n    display: none;/);
    // 44 px tap target.
    expect(css).toMatch(/\.topbar-cta \{[^}]*min-height: 44px/);
    expect(read("app/globals.css")).toMatch(/max-width: 480px\) \{[^@]*\.topbar-actions \.topbar-cta \{\s*min-height: 44px/);
  });

  it("the footer is only 'Basis · Built on BNB Chain', on every page", () => {
    const footer = read("components/site-footer.tsx");
    expect(footer).toContain("{LANDING.footer.name}");
    expect(footer).not.toMatch(/href=|financial advice/i);
    expect(LANDING.footer).toEqual({ name: "Basis · Built on BNB Chain" });
    for (const k of KEYS) expect(read(`${SITE_DIR}/${k}/page.tsx`), k).not.toMatch(/<footer|<header/);
  });

  it("the landing page has no header or footer of its own, and no 'Read more' links: the four pages open only from the menu", () => {
    const landing = read(`${SITE_DIR}/page.tsx`);
    expect(landing).not.toMatch(/<header|<footer|SiteMenu|ThemeToggle/);
    expect(landing).not.toMatch(/ReadMore|Read more/i);
    // Nothing the landing page shows points at one of the four pages.
    const words = JSON.stringify(LANDING);
    for (const path of ["/how-it-works", "/guardrails", "/findings", "/faq"]) {
      expect(landing, path).not.toContain(`"${path}`);
      expect(words, path).not.toContain(path);
    }
    // No "Read more" anywhere a visitor reads: components, pages, styles, docs.
    for (const file of ["components/site-page-parts.tsx", "components/site-content.ts", "components/landing-content.ts", "app/landing.css", "README.md", "docs/how-to-use.md", "docs/PRD.md"]) {
      expect(read(file), file).not.toMatch(/read more|ReadMore|l-readmore/i);
    }
  });

  it("the dashboard's 'what that means' link still goes somewhere sensible: the landing page's own FAQ section", () => {
    expect(readOnlyNote(true)!.linkUrl).toBe("/#faq");
    expect(read(`${SITE_DIR}/page.tsx`)).toContain('id="faq"');
    // ...which says what read-only means.
    expect(LANDING.faq.find((f) => f.q === "Can I trade on the demo?")!.a).toMatch(/read-only by design/);
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

describe("wording that was checked against the repo", () => {
  it('the instruction card says "in plain English or other languages"', () => {
    const card = LANDING.tryIt.cards.find((c) => c.title === "Give an instruction")!;
    expect(card.body).toBe('Type an order, like "Buy $200 of MSFT", in plain English or other languages.');
    expect(card.body).not.toMatch(/any language/);
  });

  it("'Does Basis make money?' claims only what was checked, up to a date, so it stays true after the freeze", () => {
    const a = LANDING.faq.find((f) => f.q === "Does Basis make money?")!.a;
    expect(a).toBe("Not so far: in every reading we checked up to 4 October 2026, the gap between the pools was smaller than the cost of trading it, and Basis is built to recognise that and not trade.");
    expect(a).not.toMatch(/recorded so far|have checked/);
    // The same words on the FAQ page.
    expect(FAQ_PAGE.items.find((x) => x.q === "Does Basis make money?")!.a).toBe(a);
  });

  it("every claim about the readings is dated, on every page and in the README, and the date is the data's last day", () => {
    // The recorder's data ends on this day (components/finding-facts.ts).
    expect(CHECKED_UNTIL).toBe("4 October 2026");
    expect(FINDING_FACTS.readings.asOf).toMatch(/^4 Oct 2026/);
    expect(FINDING_FACTS.roundTrips.period).toMatch(/2–4 Oct 2026$/);
    const claims = [
      LANDING.findings.cards[0]!.title,
      FINDINGS.findings[0]!.title,
      LANDING.faq.find((f) => f.q === "Does Basis make money?")!.a,
    ];
    for (const c of claims) expect(c, c).toMatch(/up to 4 (October|Oct) 2026/i);
    expect(ROUND_TRIPS_TITLE).toBe("Up to 4 Oct 2026, none of 222 round trips cleared costs");
    // The pool-pair claim names the days it holds for.
    expect(FINDINGS.findings[4]!.body).toContain("on 3–4 Oct");
    // Nothing says "never", "always", "every" or "none" about the market without a date next to it.
    const undated = /\b(in every reading|none cleared|never (cleared|exceeded|positive)|always (negative|below)|has been smaller|have been smaller)\b/i;
    for (const text of [JSON.stringify(LANDING), JSON.stringify({ HOW, GUARDRAILS, FINDINGS, FAQ_PAGE })]) expect(text).not.toMatch(/in every reading we have checked|has been smaller than the cost/);
    expect(undated.test("in every reading we checked up to 4 October 2026")).toBe(true); // the pattern finds the claim, so the checks below mean something
    const readme = read("README.md");
    for (const m of readme.matchAll(new RegExp(undated.source, "gi"))) {
      const around = readme.slice(Math.max(0, m.index! - 160), m.index! + 200);
      expect(around, `README: "${m[0]}" needs a date`).toMatch(/up to 4 October 2026|up to 4 Oct 2026|4 Oct 2026|4 October 2026/);
    }
    expect(readme).toContain("up to 4 October 2026");
    // No landing-page heading states the market's behaviour as a fact that could change.
    expect(LANDING.problem.title).toBe("Costs decide whether a gap pays.");
  });

  it("the ex-dividend finding is worded as the PRD records it, on the landing page, the README and the Findings page", () => {
    const body = LANDING.findings.cards.find((c) => c.title.startsWith("Dividend timing"))!.body;
    expect(body).toBe("On Microsoft's ex-dividend day the stock fell, but the bStocks and Ondo tokens moved together, in the same direction, so no issuer lagged to trade against.");
    expect(body).not.toMatch(/xStocks|rose/);
    const readme = read("README.md");
    expect(readme).toContain("real bStocks and Ondo token prices moved together, in the same direction and by a similar amount, while only the real stock dropped");
    expect(readme).not.toMatch(/xStocks and Ondo tokens all rose/);
    expect(FINDINGS.findings[1]!.body).toMatch(/same direction/);
    expect(read("docs/PRD.md")).toMatch(/both moved together, in the same direction, by a similar magnitude/);
  });

  it("the pool-pair finding covers the readings of 3–4 Oct 2026, including the wider gap, still short of the cost", () => {
    const f = FINDINGS.findings[4]!;
    expect(f.period).toBe("25–30 Sep and 3–4 Oct 2026");
    expect(f.body).toContain("about −0.5% to −1.3%");
    expect(f.body).toContain("0.7–0.8%");
    expect(f.body).toContain("1.3%");
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
    const headings: string[] = [HOW.title, GUARDRAILS.title, FINDINGS.title, FAQ_PAGE.title, GUARDRAILS.more.title, GUARDRAILS.failing.title, ...HOW.steps.map((s) => s.title), ...GUARDRAILS.checks.map((c) => c.title), ...FINDINGS.findings.map((f) => f.title)];
    for (const h of headings) expect(words(h), h).toBeLessThanOrEqual(12);
    for (const s of strings({ HOW, GUARDRAILS, FINDINGS, FAQ_PAGE })) expect(words(s), s.slice(0, 40)).toBeLessThanOrEqual(60);
  });

  it("each page stays within its word budget: explanatory but concise, not a document", () => {
    // Words a visitor reads: the page's own text, the step numbers, the closing (heading, button, back link)
    // and, on How it works, the worked example with a live reading in it (67 words; measured).
    const closing = words(`${LANDING.closing.title} ${LANDING.closing.cta.label} Back to the overview`);
    const budget = (own: unknown, extra: number) => words(strings(own).join(" ")) + extra + closing;
    expect(budget(HOW, 3 + 67)).toBeGreaterThanOrEqual(300);
    expect(budget(HOW, 3 + 67)).toBeLessThanOrEqual(400);
    expect(budget(GUARDRAILS, 6)).toBeGreaterThanOrEqual(250);
    expect(budget(GUARDRAILS, 6)).toBeLessThanOrEqual(350);
    expect(budget(FINDINGS, 0)).toBeGreaterThanOrEqual(300);
    expect(budget(FINDINGS, 0)).toBeLessThanOrEqual(400);
    // The FAQ: 8 to 10 of the most useful questions.
    expect(budget(FAQ_PAGE, 0)).toBeLessThanOrEqual(400);
    // Every section is a short claim heading and then two or three sentences at most, in cards.
    for (const s of [...HOW.steps, ...GUARDRAILS.checks]) expect(sentences(s.body), s.title).toBeLessThanOrEqual(2);
    for (const k of KEYS) {
      const page = read(`${SITE_DIR}/${k}/page.tsx`);
      expect(page, k).not.toMatch(/l-facts|l-prose p|<dl/);
    }
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
  const byName = (re: RegExp) => GUARDRAILS.checks.find((c) => re.test(c.name))!;
  const c = DEFAULT_GUARDRAIL_CONFIG;
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

  it("six checks, each said in one or two sentences: what it does, its limit, what happens when it fails", () => {
    expect(GUARDRAILS.checks.map((x) => x.name)).toEqual(["Per-trade cap", "Daily cap", "Reference price", "Market status", "Price sanity and liquidity", "Dry-run floor"]);
    for (const x of GUARDRAILS.checks) {
      expect(sentences(x.body), x.name).toBeLessThanOrEqual(2);
      expect(words(x.body), x.name).toBeLessThanOrEqual(45);
      // Every card says what happens on a failure: a block, a "warming up" or a "pending".
      expect(x.body, x.name).toMatch(/block|warming up|pending|refus/);
    }
  });

  it("the numbers equal lib/guardrails/config.ts", () => {
    expect(byName(/Per-trade/).body).toContain(`${usd(c.perTradeCapUsd)}`);
    expect(byName(/Per-trade/).title).toContain(usd(c.perTradeCapUsd));
    expect(byName(/Daily/).body).toContain(usd(c.perDayCapUsd));
    expect(byName(/Reference/).body).toContain(`within ${c.maxReferenceDivergencePct * 100}%`);
    expect(byName(/Dry-run/).body).toContain(`at least ${c.minDryRunOutputRatio * 100}%`);
    const sanity = byName(/sanity/).body;
    expect(sanity).toContain(`within ${c.maxPriceDeviationPct * 100}%`);
    expect(sanity).toContain(`at least ${usd(c.minLiquidityDepthUsd)}`);
    expect(sanity).toContain(`at least ${c.minPriceHistoryReadings} readings`);
    expect(sanity).toContain(`fewer than ${c.minPriceHistoryReadings} readings`);
    const more = JSON.stringify(GUARDRAILS.more);
    expect(more).toContain(`${c.minSpreadRetentionRatio * 100}%`.replace("50%", "half"));
    expect(more).toContain(`${c.sendSlippageTolerance * 100}%`);
  });

  it("market status lists exactly the codes the check passes and blocks on", () => {
    const m = byName(/Market status/).body;
    for (const code of [...MARKET_STATUS_PASS_CODES, ...MARKET_STATUS_BLOCK_CODES]) expect(m, code).toContain(code);
    expect(m).toMatch(/closed stock market doesn't stop it/);
    expect(m).toMatch(/unknown or can't be fetched/);
  });

  it("failures are logged, and nothing can be sent on the public site", () => {
    expect(GUARDRAILS.failing.body).toMatch(/audit ledger/);
    expect(GUARDRAILS.failing.body).toMatch(/no wallet key and refuses live mode/);
  });
});

describe("Findings page: real data, with its period, how it was measured and why it matters", () => {
  it("every finding is a claim, a data period, and a sentence or two on how it was measured and why it matters", () => {
    expect(FINDINGS.findings.map((f) => f.period)).toEqual([FINDING_FACTS.roundTrips.period, "20 Aug 2026", "18–21 Sep 2026", "25 Sep 2026", "25–30 Sep and 3–4 Oct 2026"]);
    for (const f of FINDINGS.findings) {
      expect(f.title.length, f.title).toBeGreaterThan(10);
      expect(sentences(f.body), f.title).toBeLessThanOrEqual(2);
      expect(words(f.body), f.title).toBeLessThanOrEqual(55);
    }
  });

  it("the recounted round trips (222 fresh, none cleared), dated, and the data quality", () => {
    // Recounted from the recorder's export on 2026-10-04 11:05 UTC.
    expect(FINDING_FACTS.roundTrips).toMatchObject({ count: 222, cleared: 0, best: "−0.013%", median: "−0.21%", period: "26–30 Sep and 2–4 Oct 2026" });
    expect(FINDING_FACTS.readings).toMatchObject({ total: 13803, valid: 8521, asOf: "4 Oct 2026, 11:05 UTC" });
    const first = FINDINGS.findings[0]!;
    expect(first.title).toBe("Up to 4 Oct 2026, none of 222 round trips cleared costs");
    expect(first.body).toMatch(/at most 60 seconds/);
    expect(first.body).toContain("−0.013%");
    expect(first.body).toContain("−0.21%");
    expect(first.note).toContain("8,521 of 13,803 readings were valid, as of 4 Oct 2026, 11:05 UTC");
    expect(first.note).toContain("30 Sep 05:48");
    expect(first.note).toContain("2 Oct 22:52");
  });

  it("the landing page's round-trip card is the same recount", () => {
    const card = LANDING.findings.cards[0]!;
    expect(card.title).toBe(FINDINGS.findings[0]!.title);
    expect(card.period).toBe(FINDING_FACTS.roundTrips.period);
    expect(card.body).toContain(FINDING_FACTS.roundTrips.best);
  });

  it("dividend timing and weekend gaps are described as the PRD records them", () => {
    const [, dividend, weekend] = FINDINGS.findings;
    expect(dividend!.title).toBe("Dividend timing: the tokens moved together.");
    expect(dividend!.body).toMatch(/same direction/);
    expect(weekend!.title).toBe("Weekend gaps: there was no gap to trade.");
    expect(weekend!.body).toMatch(/no gap and no freeze/);
    const prd = read("docs/PRD.md");
    expect(prd).toContain("2026-08-20 ex-dividend");
    expect(prd).toContain("Friday-to-Monday window");
  });
});

describe("How it works page", () => {
  it("three steps (Read, Count, Guard), the formula, and which Binance Web3 API modules are used where", () => {
    expect(HOW.steps.map((s) => s.name)).toEqual(["Read", "Count", "Guard"]);
    expect(HOW.formula).toBe(LANDING.how.formula);
    const apis = JSON.stringify(HOW.apis);
    for (const part of ["aggregator/quote", "rwa/underlying-market", "rwa/price", "pre-transaction/simulate", "broadcast-transaction", "Trading API", "RWA Data API", "Transaction API", "Groq"]) {
      expect(apis, part).toContain(part);
    }
    // The public site never reaches the Transaction API.
    expect(HOW.apis.find((a) => /Transaction/.test(a.title))!.body).toMatch(/public site never reaches it/);
    for (const s of HOW.steps) expect(sentences(s.body), s.name).toBeLessThanOrEqual(2);
  });

  it("the stated numbers are the code's: 30 s, 0.05% slippage, gas ×2, 0.01% threshold", () => {
    const text = JSON.stringify({ title: HOW.title, steps: HOW.steps });
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
  const all = FAQ_PAGE.items;

  it("ten of the most useful questions, each answered in one or two sentences; every landing question is here, word for word", () => {
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.length).toBeLessThanOrEqual(10);
    for (const f of LANDING.faq) expect(all.find((x) => x.q === f.q)?.a, f.q).toBe(f.a);
    expect(new Set(all.map((x) => x.q)).size).toBe(all.length);
    for (const f of all) expect(sentences(f.a), f.q).toBeLessThanOrEqual(2);
  });

  it("the answers match the code and docs", () => {
    const a = (q: RegExp) => all.find((x) => q.test(x.q))!.a;
    expect(a(/net edge/i)).toContain("0.01%");
    expect(a(/kept/i)).toMatch(/memory/);
    expect(read("LICENSE")).toMatch(/^MIT License/);
    expect(a(/code/i)).toContain("MIT");
    expect(a(/tokenized stock/i)).toBe(LANDING.tokenized.body);
  });

  it("'what if the net edge turns positive?' says what the code does: a $200 order, six checks, simulated, not sent", () => {
    const a = all.find((x) => /turns positive/.test(x.q))!.a;
    expect(a).toContain("$200 order");
    expect(a).toContain("six guardrails");
    expect(a).toContain("nothing is sent");
    // The ledger's own words for it (what test/positive-edge.test.ts shows on the dashboard).
    expect(a).toContain(ledgerVerdictWord({ approved: true, status: "approved", checks: [] }, "simulated"));
    expect(read("lib/orchestration/agent-loop.ts")).toMatch(/orderSizeUsd: 200/);
    expect(read("lib/execution/pipeline.ts")).toMatch(/if \(mode === "simulation"\) \{\s*return record\(\{ mode, outcome: "simulated"/);
  });
});

describe("every page works at every width (styles exist for the layouts the pages use)", () => {
  it("the page styles are the landing page's, in one file loaded only by these pages", () => {
    const css = read("app/landing.css");
    for (const cls of [".l-pagehead", ".l-back", ".l-note", ".l-worked", ".l-detail", ".l-closing"]) expect(css, cls).toContain(cls);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    // 44 px tap target for the small links.
    const rule = css.slice(css.indexOf(".l-back {"), css.indexOf("}", css.indexOf(".l-back {")));
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(readdirSync(join(ROOT, "app")).filter((n) => n.endsWith(".css")).sort()).toEqual(["globals.css", "landing.css"]);
  });
});
