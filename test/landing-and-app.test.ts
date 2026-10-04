import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LANDING, DEMO_VIDEO_URL, GITHUB_URL } from "../components/landing-content";
import { ageLabel, liveReadingView, STALE_AFTER_S } from "../components/live-reading-view";
import { showWalletChips } from "../components/public-mode";
import { readOnlyNote } from "../components/read-only-note";

// The landing page (/) explains; the dashboard (/app) only shows what's
// live. Landing copy comes only from basis-project-details.md and follows
// its rules (section 1).

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const LANDING_FILES = ["app/(site)/page.tsx", "app/(site)/layout.tsx", "components/site-header.tsx", "components/site-footer.tsx", "components/landing-content.ts", "components/landing-live-reading.tsx", "components/live-reading-view.ts", "components/landing-visuals.tsx", "components/landing-motion.tsx"];
const landingSrc = LANDING_FILES.map((f) => read(f)).join("\n");
const landingText = JSON.stringify(LANDING);

describe("routes", () => {
  it("the landing page is at /, the dashboard at /app, and every API route is unchanged", async () => {
    expect(existsSync(join(ROOT, "app", "(site)", "page.tsx"))).toBe(true);
    // The dashboard's file is app/dashboard/page.tsx, served at /app by a
    // rewrite. A route folder named "app" breaks Next's build when the
    // project root is itself /app (Railway's container): / rendered the
    // dashboard (live, 2026-09-29; reproduced in WSL).
    expect(existsSync(join(ROOT, "app", "dashboard", "page.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "app", "app"))).toBe(false);
    const config = (await import("../next.config")).default;
    expect(await config.rewrites!()).toEqual([{ source: "/app", destination: "/dashboard" }]);
    expect(await config.redirects!()).toEqual([{ source: "/dashboard", destination: "/app", permanent: false }]);
    for (const r of ["execution-test", "health", "instruction", "issuers", "issuers/summary", "killswitch", "ledger", "opportunities", "reading", "status"]) {
      expect(existsSync(join(ROOT, "app", "api", r, "route.ts")), r).toBe(true);
    }
  });

  it("links both ways: the landing page's main button opens /app; the dashboard's wordmark goes home", () => {
    expect(LANDING.hero.primary).toEqual({ label: "Open the dashboard", href: "/app" });
    expect(read("app/(site)/page.tsx")).toContain("href={hero.primary.href}");
    expect(read("components/header.tsx")).toContain('href="/"');
    // GitHub stays reachable from the landing page's "Read the code" button.
    expect(LANDING.hero.secondary.href).toBe(GITHUB_URL);
    expect(GITHUB_URL).toBe("https://github.com/blaxko/basis");
    for (const id of ["how", "guardrails", "findings", "faq"]) expect(read("app/(site)/page.tsx")).toContain(`id="${id}"`);
  });

  it("the README's first section gives both URLs and the $1000 safety-block example", () => {
    const readme = read("README.md");
    const first = readme.slice(0, readme.indexOf("## What Basis is"));
    expect(first).toContain("https://basis-production-c229.up.railway.app**");
    expect(first).toContain("https://basis-production-c229.up.railway.app/app");
    expect(first).toContain("Buy $1000 of MSFT");
    expect(first).toContain("no wallet, deposit or sign-up needed");
  });
});

describe("landing content follows basis-project-details.md", () => {
  it("the hero says what Basis is: an identity line, the claim, two sentences; the closing repeats the claim and the button", () => {
    expect(LANDING.hero.eyebrow).toBe("An arbitrage agent for tokenized stocks on BNB Chain");
    expect(LANDING.hero.title).toBe("A price gap isn't a profit.");
    expect(LANDING.hero.lede).toHaveLength(2);
    expect(LANDING.hero.lede[0]).toMatch(/MSFTB.*two PancakeSwap pools.*every cost.*real edge/);
    expect(LANDING.hero.lede[1]).toBe('Every decision, including "no", is logged.');
    expect(LANDING.closing).toEqual({ title: LANDING.hero.title, cta: LANDING.hero.primary });
    const css = read("app/landing.css");
    const eyebrow = css.slice(css.indexOf(".l-eyebrow {"), css.indexOf("}", css.indexOf(".l-eyebrow {")));
    expect(eyebrow).not.toMatch(/uppercase/);
  });

  it("the sections, in order, each with a short claim for a heading", () => {
    const page = read("app/(site)/page.tsx");
    const order = ["{hero.title}", "{tokenized.title}", "{problem.title}", "{how.title}", "{tryIt.title}", "{guardrails.title}", "{findings.title}", "{builtWith.title}", "{LANDING.faqTitle}", "{closing.title}"];
    const at = order.map((k) => page.indexOf(k));
    expect(at.every((i) => i > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const key of ["tokenized", "problem", "how", "tryIt", "guardrails", "findings"] as const) expect(LANDING[key].title.split(" ").length, key).toBeLessThanOrEqual(7);
    expect(page).not.toMatch(/FactTicker|l-ticker|<table/);
  });

  it("every card is one full sentence", () => {
    const cards = [...LANDING.problem.cards, ...LANDING.how.steps, ...LANDING.tryIt.cards, ...LANDING.guardrails.cards, ...LANDING.findings.cards];
    for (const c of cards) {
      expect(c.body, c.title).toMatch(/^[A-Z].*\.$/);
      expect(c.body.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 1).length, c.title).toBe(1);
    }
  });

  it("roughly 500-700 words in total", () => {
    const { ...content } = LANDING;
    const words = JSON.stringify(content)
      .replace(/"[a-zA-Z]+":/g, " ")
      .replace(/"\/app[^"]*"|"https?:[^"]*"/g, " ")
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w)).length;
    expect(words).toBeGreaterThanOrEqual(500);
    expect(words).toBeLessThanOrEqual(720);
  });

  it("problem, how it works and the four dashboard cards, each linking to its section of /app", () => {
    expect(LANDING.problem.cards.map((c) => c.title)).toEqual(["The gap", "The costs", "Basis counts every cost first"]);
    expect(LANDING.problem.cards[1]!.body).toContain("1.25%");
    expect(LANDING.how.steps.map((s) => s.title)).toEqual(["Read", "Count", "Guard"]);
    expect(LANDING.how.formula).toBe("net edge = gap − fees − slippage − gas");
    expect(LANDING.tryIt.cards.map((c) => c.href)).toEqual(["/app#spread", "/app#instruction", "/app#gate", "/app#ledger"]);
    const dashboard = ["app/dashboard/page.tsx", "components/pool-spread-monitor.tsx", "components/instruction-box.tsx", "components/guardrail-checklist.tsx", "components/audit-ledger.tsx"].map((f) => read(f)).join("\n");
    for (const c of LANDING.tryIt.cards) expect(dashboard, c.href).toContain(`id="${c.href.split("#")[1]}"`);
  });

  it.each([
    "revolutionary", "game-changing", "cutting-edge", "seamless", "unlock", "unleash", "empower", "supercharge", "next-generation",
    "state-of-the-art", "harness", "elevate", "effortless", "the future of", "official", "partner", "institutional", "AI-powered",
    "guaranteed", "risk-free", "profitable", "earn",
  ])("never says %s", (word) => {
    expect(landingSrc).not.toMatch(new RegExp(`\\b${word}`, "i"));
  });

  it("no hackathon, test trade, transactions, wallet address, logos, emoji or exclamation marks", () => {
    expect(landingSrc).not.toMatch(/hackathon|BNB Hack/i);
    expect(landingSrc).not.toMatch(/\$5\b|test trade|bscscan|0x[0-9a-fA-F]{64}|trading wallet|0x0bA556a2/i);
    expect(landingSrc).not.toMatch(/<img|<Image|\.svg["']|\.png["']|logo/i);
    expect(landingSrc).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(landingText).not.toContain("!");
  });

  it("six guardrail cards, each one plain sentence with the real limit (lib/guardrails/config.ts)", () => {
    const g = Object.fromEntries(LANDING.guardrails.cards.map((c) => [c.title, c.body]));
    expect(Object.keys(g)).toEqual(["Per-trade cap", "Daily cap", "Reference price", "Market status", "Price sanity and liquidity", "Dry-run floor"]);
    expect(g["Per-trade cap"]).toContain("$500");
    expect(g["Daily cap"]).toMatch(/\$2,000.*UTC day/);
    expect(g["Reference price"]).toContain("within 2% of Binance's own quote");
    expect(g["Market status"]).toMatch(/paused, limited or unknown; a closed market doesn't stop it/);
    expect(g["Price sanity and liquidity"]).toContain("$1,000");
    expect(g["Dry-run floor"]).toContain("98%");
    const config = read("lib/guardrails/config.ts");
    for (const real of ["perTradeCapUsd: 500,", "perDayCapUsd: 2000,", "maxReferenceDivergencePct: 0.02,", "minDryRunOutputRatio: 0.98,", "minLiquidityDepthUsd: 1000,"]) {
      expect(config, real).toContain(real);
    }
    for (const wrong of [/truncat/i, /24-hour/i, /must report active/i, /confirms trading hours/i, /net realized/i, /\+41 bps/]) expect(landingText).not.toMatch(wrong);
  });

  it("findings: clear statements with their dates", () => {
    const [roundTrips, dividend, weekend] = LANDING.findings.cards;
    // Recounted from the recorder's export on 2026-10-04 04:20 UTC. 206 fresh
    // valid round trips, none cleared, best −0.013% (components/finding-facts.ts).
    expect(roundTrips!.title).toBe("206 fresh round trips between bStocks and Ondo: none cleared costs");
    expect(roundTrips!.period).toBe("26–30 Sep and 2–4 Oct 2026");
    expect(roundTrips!.body).toContain("−0.013%");
    expect(dividend).toMatchObject({ title: "Dividend timing: tested with real prices, rejected", period: "20 Aug 2026" });
    expect(weekend).toMatchObject({ title: "Weekend gaps: tested with real prices, rejected", period: "18–21 Sep 2026" });
  });

  it("built with, as text only", () => {
    expect(LANDING.builtWith.items).toEqual(["BNB Chain", "PancakeSwap V3", "Binance Web3 API (Trading, Transaction and RWA Data modules)", "Groq, for reading typed instructions"]);
  });

  it("the FAQ keeps the four answers, adds what Basis is for, and says plainly that Basis doesn't make money", () => {
    expect(LANDING.faq.map((f) => f.q)).toEqual(["What is Basis for?", "Does Basis make money?", "Can I trade on the demo?", "Is the AI making trading decisions?", "Why only Microsoft?"]);
    expect(LANDING.faq[1]!.a.startsWith("No.")).toBe(true);
  });

  it("the demo video: nothing at all until its URL is set, then a 'Watch the demo' link", () => {
    expect(DEMO_VIDEO_URL).toBeNull();
    expect(LANDING.hero.videoLabel).toBe("Watch the demo");
    expect(read("app/(site)/page.tsx")).toMatch(/\{DEMO_VIDEO_URL && \(/);
    expect(landingSrc).not.toMatch(/coming soon/i);
  });

  it("no shader, canvas, animation loop or CDN scripts", () => {
    expect(landingSrc).not.toMatch(/webgl|three\.js|<canvas|requestAnimationFrame|cdn\.|tailwind/i);
  });

  it("no uppercase section labels on the landing page, and its styles load only on the landing page", () => {
    const css = read("app/landing.css");
    expect(css.length).toBeGreaterThan(1000);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(read("app/(site)/layout.tsx")).toContain(`import "../landing.css";`);
    expect(read("app/globals.css")).not.toMatch(/\.l-hero|\.l-tile|\.live-card/);
  });
});

describe("the landing page's live reading", () => {
  // A real reading, 2026-09-28 22:56:37 UTC.
  const reading = {
    at: "2026-09-28T22:56:37.644Z",
    tradeSizeUsd: 200,
    pools: [
      { fee: "0.25%", priceUsd: 510.7387114316477 },
      { fee: "1%", priceUsd: 509.0837624859116 },
    ],
    grossGap: 0.0032508382071641216,
    totalCost: -0.013034893329619136,
    netEdge: -0.009784055122455015,
    lines: [
      { key: "buyFee" as const, pct: -0.009933176615912469, usd: 1.9866353231824938, feeUnits: 10000 },
      { key: "sellFee" as const, pct: -0.0024832941539781163, usd: 0.4966588307956233, feeUnits: 2500 },
      { key: "slippage" as const, pct: -0.0005, usd: 0.1 },
      { key: "gas" as const, pct: -0.00011842255972855192, usd: 0.023684511945710383 },
    ],
  };
  const at = Date.parse(reading.at);

  it("shows the latest recorded reading and how old it is", () => {
    expect(liveReadingView(reading, at + 20_000)).toEqual({ kind: "ok", ageS: 20, ...reading });
    expect(ageLabel(20)).toBe("updated 20 s ago");
    expect(ageLabel(150)).toBe("updated 3 min ago");
  });

  it("no reading, or one too old to call live: unavailable, and no number at all", () => {
    expect(liveReadingView(null, at)).toEqual({ kind: "unavailable" });
    expect(liveReadingView(reading, at + (STALE_AFTER_S + 1) * 1000)).toEqual({ kind: "unavailable" });
  });

  it("arrives server-rendered with real values (never a loading state), then refreshes from /api/reading", () => {
    const page = read("app/(site)/page.tsx");
    expect(page).toContain('import { GET as getReading } from "../api/reading/route";');
    expect(page).toContain("<LandingLiveReading initial={reading} renderedAt={renderedAt} />");
    expect(page).toContain('export const dynamic = "force-dynamic";');
    const card = read("components/landing-live-reading.tsx");
    expect(card).toContain("useState<LiveReading | null>(initial)");
    expect(card).toContain('fetch("/api/reading"');
    expect(card).toContain("const POLL_MS = 30_000;");
    expect(card).toContain("Live reading unavailable");
    expect(card).toContain('href="/app"');
    expect(card).not.toMatch(/Loading/);
  });
});

describe("the dashboard shows only what's live", () => {
  const ui = ["app/dashboard/page.tsx", "components/header.tsx", "components/pool-spread-monitor.tsx", "components/instruction-box.tsx", "components/guardrail-checklist.tsx", "components/audit-ledger.tsx", "components/issuer-monitor.tsx", "components/advisory-feed.tsx", "components/read-only-note.ts"].map((f) => read(f)).join("\n");

  it("no Start here panel, sidebar, BscScan links, test trade or hackathon", () => {
    for (const gone of ["components/start-here.tsx", "components/start-here-content.ts", "components/sidebar-nav.tsx"]) expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    expect(ui).not.toMatch(/StartHere|SidebarNav|bscscan|\$5 round trip|\$5 test|hackathon|0x[0-9a-fA-F]{64}/i);
  });

  it("keeps the live parts, in the phone order: live reading, instruction, gate, ledger, issuer monitor", () => {
    const page = read("app/dashboard/page.tsx");
    const order = ["<PoolSpreadMonitor />", "<InstructionBox />", "<GuardrailChecklist />", "<AuditLedger />", "<IssuerMonitor />"].map((c) => page.indexOf(c));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the public demo hides the trading wallet's address and balances; a local run still shows them", () => {
    expect(showWalletChips(true)).toBe(false);
    expect(showWalletChips(false)).toBe(true);
    const header = read("components/header.tsx");
    const guard = header.indexOf("showWalletChips(readOnly) && (");
    expect(guard).toBeGreaterThan(0);
    for (const chip of ["Trading wallet", "walletChipLabel("]) expect(header.indexOf(chip)).toBeGreaterThan(guard);
  });

  it("the read-only note is one short line linking the landing page's explanation", () => {
    const note = readOnlyNote(true)!;
    expect(note.text).toBe("Public demo: read-only");
    expect(note.linkUrl).toBe("/#faq");
    expect(note.liveButtonTitle).toContain("read-only");
  });

  it("secondary detail sits behind toggles: the cost breakdown and the Advisory Feed", () => {
    const monitor = read("components/pool-spread-monitor.tsx");
    expect(monitor).toMatch(/<details[^>]*id="costs"/);
    expect(read("components/advisory-feed.tsx")).toContain("<details");
  });
});

describe("headers, footers, menu and theme toggle", () => {
  const dashboard = () => read("app/dashboard/page.tsx");
  const header = () => read("components/header.tsx");

  it("both footers say only 'Basis · Built on BNB Chain'", () => {
    expect(LANDING.footer).toEqual({ name: "Basis · Built on BNB Chain" });
    const footer = read("components/site-footer.tsx");
    expect(footer).toContain("{LANDING.footer.name}");
    expect(footer).not.toMatch(/href=|risk|Not financial advice/);
    expect(dashboard()).toContain('<footer className="footer">Basis · Built on BNB Chain</footer>');
  });

  it("the dashboard header links only home: no How it works, no GitHub", () => {
    expect(header()).toContain('href="/"');
    expect(header()).not.toMatch(/How it works|GITHUB_URL|github\.com/);
  });

  it("the dashboard's menu uses short names, and every link lands on a panel that exists", async () => {
    const { DASHBOARD_SECTIONS } = await import("../components/site-sections");
    expect(DASHBOARD_SECTIONS.map((s) => s.label)).toEqual(["Live spread", "Instruction", "Guardrails", "Ledger", "Issuers"]);
    const src = ["app/dashboard/page.tsx", "components/pool-spread-monitor.tsx", "components/instruction-box.tsx", "components/guardrail-checklist.tsx", "components/audit-ledger.tsx", "components/issuer-monitor.tsx"].map((f) => read(f)).join("\n");
    for (const s of DASHBOARD_SECTIONS) {
      expect(s.href).toMatch(/^#[a-z-]+$/);
      expect(src, s.href).toContain(`id="${s.href.slice(1)}"`);
      expect(s.label.split(" ").length).toBeLessThanOrEqual(3);
    }
    expect(header()).toContain("<SiteMenu sections={DASHBOARD_SECTIONS} />");
  });

  it("the menu is accessible: expanded state, controls, labels, Escape, outside tap, focus", () => {
    const menu = read("components/site-menu.tsx");
    for (const needle of ["aria-expanded={open}", "aria-controls={id}", '"Close menu"', '"Open menu"', '"Escape"', '"pointerdown"', ".focus()"]) {
      expect(menu, needle).toContain(needle);
    }
  });

  it("the theme toggle is on both pages, labelled, and remembers the choice", () => {
    const toggle = read("components/theme-toggle.tsx");
    expect(toggle).toContain("THEME_STORAGE_KEY");
    expect(toggle).toContain('setAttribute("data-theme"');
    expect(toggle).toMatch(/aria-label=\{`Switch to \$\{/);
    expect(read("components/site-header.tsx")).toContain("<ThemeToggle />");
    expect(header()).toContain("<ThemeToggle />");
  });

  it("the chart is plain SVG (no charting library), follows the theme, and its hover box opens on the side with room", () => {
    const chart = read("components/spread-chart.tsx");
    expect(chart).not.toMatch(/recharts|TOKENS\./);
    expect(JSON.parse(read("package.json")).dependencies.recharts).toBeUndefined();
    expect(chart).toContain('"var(--color-chart-gross)"');
    expect(chart).toContain("x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }");
    // Loaded with the page, into a box of fixed height: no layout shift.
    expect(read("components/pool-spread-monitor.tsx")).toContain("CHART_BOX_HEIGHT");
  });

  it("the chart's axis always includes zero, with round steps", async () => {
    const { axisIncludingZero } = await import("../components/spread-chart");
    // Real values: gross gap +0.325%, net edge -0.978% (2026-09-28).
    const a = axisIncludingZero([0.00325, -0.00978]);
    expect(a.ticks).toContain(0);
    expect(a.yMin).toBeLessThanOrEqual(-0.00978);
    expect(a.yMax).toBeGreaterThanOrEqual(0.00325);
  });

  it("status chips wrap instead of being clipped", () => {
    const css = read("app/globals.css");
    const start = css.search(/^\.status-row \{/m);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(start).toBeGreaterThan(0);
    expect(rule).toContain("flex-wrap: wrap");
    expect(rule).not.toMatch(/overflow-x:\s*auto/);
  });
});
