import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LANDING, DEMO_VIDEO_URL, GITHUB_URL } from "../components/landing-content";
import { liveReadingView } from "../components/live-reading-view";
import { showWalletChips } from "../components/public-mode";
import { readOnlyNote } from "../components/read-only-note";
import type { OpportunitiesResponse } from "../components/api-types";

// The landing page (/) explains; the dashboard (/app) only shows what's
// live. Landing copy comes only from basis-project-details.md and follows
// its rules (section 1).

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const LANDING_FILES = ["app/page.tsx", "components/landing-content.ts", "components/landing-live-reading.tsx", "components/live-reading-view.ts", "components/landing-visuals.tsx", "components/landing-motion.tsx"];
const landingSrc = LANDING_FILES.map((f) => read(f)).join("\n");
const landingText = JSON.stringify(LANDING);

describe("routes", () => {
  it("the landing page is at /, the dashboard at /app, and every API route is unchanged", async () => {
    expect(existsSync(join(ROOT, "app", "page.tsx"))).toBe(true);
    // The dashboard's file is app/dashboard/page.tsx, served at /app by a
    // rewrite. A route folder named "app" breaks Next's build when the
    // project root is itself /app (Railway's container): / rendered the
    // dashboard (live, 2026-09-29; reproduced in WSL).
    expect(existsSync(join(ROOT, "app", "dashboard", "page.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "app", "app"))).toBe(false);
    const config = (await import("../next.config")).default;
    expect(await config.rewrites!()).toEqual([{ source: "/app", destination: "/dashboard" }]);
    expect(await config.redirects!()).toEqual([{ source: "/dashboard", destination: "/app", permanent: false }]);
    for (const r of ["execution-test", "health", "instruction", "issuers", "issuers/summary", "killswitch", "ledger", "opportunities", "status"]) {
      expect(existsSync(join(ROOT, "app", "api", r, "route.ts")), r).toBe(true);
    }
  });

  it("links both ways: the landing page's main button opens /app; the dashboard's wordmark goes home", () => {
    expect(LANDING.hero.primary).toEqual({ label: "Open the dashboard", href: "/app" });
    expect(read("app/page.tsx")).toContain("LANDING.hero.primary.href");
    expect(read("components/header.tsx")).toContain('href="/"');
    // GitHub stays reachable from the landing page's "Read the code" button.
    expect(LANDING.hero.secondary.href).toBe(GITHUB_URL);
    expect(GITHUB_URL).toBe("https://github.com/blaxko/basis");
    for (const id of ["how", "guardrails", "findings", "faq"]) expect(read("app/page.tsx")).toContain(`id="${id}"`);
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
  it("the hero: a short claim, one sentence, and the closing section repeats the claim and the button", () => {
    expect(LANDING.hero.title).toBe("A price gap isn't a profit.");
    expect(LANDING.hero.lede).toBe("Basis watches Microsoft's token in two PancakeSwap pools every 30 seconds and only trades when the gap survives every cost.");
    expect(LANDING.closing).toEqual({ title: LANDING.hero.title, cta: LANDING.hero.primary });
    const page = read("app/page.tsx");
    expect(page).toContain("{closing.title}");
    expect(page).toContain("href={closing.cta.href}");
  });

  it("scannable: each section is a short claim with at most about 60 words", () => {
    const words = (v: unknown) => JSON.stringify(v).replace(/"[a-z]+":/gi, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    for (const key of ["problem", "how", "guardrails", "findings"] as const) {
      const section = LANDING[key];
      expect(section.title.split(" ").length, key).toBeLessThanOrEqual(8);
      expect(words(section), key).toBeLessThanOrEqual(70);
    }
    expect(LANDING.problem.cards).toHaveLength(3);
    expect(LANDING.how.steps.map((s) => s.title)).toEqual(["Read", "Count", "Guard"]);
    expect(LANDING.how.formula).toBe("net edge = gap − fees − slippage − gas");
    expect(LANDING.findings.cards).toHaveLength(3);
    expect(read("app/page.tsx")).not.toMatch(/<table/);
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

  it("six guardrail cards with their real limits (lib/guardrails/config.ts), no table", () => {
    expect(LANDING.guardrails.cards.map((g) => [g.title, g.limit])).toEqual([
      ["Per-trade cap", "$500 per trade"],
      ["Daily cap", "$2,000 per UTC day"],
      ["Reference price", "Within 2% of Binance's quote"],
      ["Market status", "Paused, limited or unknown blocks; closed doesn't"],
      ["Price sanity and liquidity", "Sane prices, $1,000+ in each pool"],
      ["Dry-run floor", "98% simulation floor"],
    ]);
    const config = read("lib/guardrails/config.ts");
    for (const real of ["perTradeCapUsd: 500,", "perDayCapUsd: 2000,", "maxReferenceDivergencePct: 0.02,", "minDryRunOutputRatio: 0.98,", "minLiquidityDepthUsd: 1000,"]) {
      expect(config, real).toContain(real);
    }
    for (const wrong of [/truncat/i, /24-hour/i, /must report active/i, /confirms trading hours/i, /net realized/i, /\+41 bps/]) expect(landingText).not.toMatch(wrong);
  });

  it("findings: three real numbers, each with its date or data period", () => {
    const [roundTrips, dividend, weekend] = LANDING.findings.cards;
    // Recounted from the recorder's export on 2026-09-30: 114 fresh valid
    // round trips, 26–29 Sep 2026, none cleared, best −0.013%.
    expect(roundTrips).toMatchObject({ value: "114", period: "26–29 Sep 2026" });
    expect(roundTrips!.body).toContain("None cleared costs");
    expect(roundTrips!.body).toContain("−0.013%");
    expect(dividend!.period).toBe("20 Aug 2026");
    expect(weekend!.period).toBe("18–21 Sep 2026");
    expect(landingText).toContain("Monitor only");
  });

  it("the FAQ says plainly that Basis doesn't make money", () => {
    expect(LANDING.faq[0]!.q).toBe("Does Basis make money?");
    expect(LANDING.faq[0]!.a.startsWith("No.")).toBe(true);
  });

  it("the demo video: nothing at all until its URL is set, then a 'Watch the demo' link", () => {
    expect(DEMO_VIDEO_URL).toBeNull();
    expect(LANDING.hero.videoLabel).toBe("Watch the demo");
    const page = read("app/page.tsx");
    expect(page).toMatch(/\{DEMO_VIDEO_URL && \(/);
    expect(landingSrc).not.toMatch(/coming soon/i);
  });

  it("no shader, canvas, animation loop or CDN scripts", () => {
    expect(landingSrc).not.toMatch(/webgl|three\.js|<canvas|requestAnimationFrame|cdn\.|tailwind/i);
  });

  it("no uppercase section labels on the landing page", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("/* --- Landing page"), css.indexOf("/* --- End landing page"));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/text-transform:\s*uppercase/);
  });
});

describe("the landing page's live reading", () => {
  const point = { timestamp: "2026-09-28T22:56:37.644Z", cheapPoolPriceUsd: 509.0837624859116, cheapPoolFeeUnits: 10000, expensivePoolPriceUsd: 510.7387114316477, expensivePoolFeeUnits: 2500, rawSpread: 0.0032508382071641216, adjustedSpread: -0.009784055122455015 };
  const costs = { grossGap: 0.0032508382071641216, lines: [], totalCostPct: -0.013034893329619136, netEdge: -0.009784055122455015, tradeSizeUsd: 200, at: "2026-09-28T22:56:37.644Z" };
  // Real values: /api/opportunities, 2026-09-28 22:56:37 UTC.
  const data = { history: { MSFT: { source: "live", points: [point], total: 1, costs } } } as unknown as OpportunitiesResponse;

  it("shows the API's own numbers: both pools by fee, gross gap, total costs, net edge", () => {
    expect(liveReadingView(data, null)).toEqual({
      kind: "ok",
      at: "2026-09-28T22:56:37.644Z",
      tradeSizeUsd: 200,
      pools: [
        { fee: "0.25%", priceUsd: 510.7387114316477 },
        { fee: "1%", priceUsd: 509.0837624859116 },
      ],
      grossGap: 0.0032508382071641216,
      totalCost: -0.013034893329619136,
      netEdge: -0.009784055122455015,
    });
  });

  it("when the call fails, or there's no live evaluation yet: unavailable, and no number at all", () => {
    for (const v of [liveReadingView(null, "HTTP 500"), liveReadingView({ history: {} } as unknown as OpportunitiesResponse, null), liveReadingView({ history: { MSFT: { ...data.history.MSFT, source: "historical" } } } as unknown as OpportunitiesResponse, null)]) {
      expect(v).toEqual({ kind: "unavailable" });
    }
    expect(liveReadingView(null, null)).toEqual({ kind: "loading" });
  });

  it("the card says 'Live reading unavailable' with a link to the dashboard, polls every 30 s, and has no animation", () => {
    const card = read("components/landing-live-reading.tsx");
    expect(card).toContain('usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS)');
    expect(card).toContain("const POLL_MS = 30_000;");
    expect(card).toContain("Live reading unavailable");
    expect(card).toContain('href="/app"');
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
  const landing = () => read("app/page.tsx");
  const dashboard = () => read("app/dashboard/page.tsx");
  const header = () => read("components/header.tsx");

  it("both footers say only 'Basis · Built on BNB Chain'", () => {
    expect(LANDING.footer).toEqual({ name: "Basis · Built on BNB Chain" });
    const footer = landing().slice(landing().indexOf("<footer"), landing().indexOf("</footer>"));
    expect(footer).toContain("{footer.name}");
    expect(footer).not.toMatch(/href=|risk|Not financial advice/);
    expect(dashboard()).toContain('<footer className="footer">Basis · Built on BNB Chain</footer>');
  });

  it("the dashboard header links only home: no How it works, no GitHub", () => {
    expect(header()).toContain('href="/"');
    expect(header()).not.toMatch(/How it works|GITHUB_URL|github\.com/);
  });

  it("each page's menu uses short names, and every section link lands on a section that exists", async () => {
    const { LANDING_SECTIONS, DASHBOARD_SECTIONS } = await import("../components/site-sections");
    expect(LANDING_SECTIONS.map((s) => s.label)).toEqual(["How it works", "Guardrails", "Findings", "FAQ", "GitHub"]);
    expect(LANDING_SECTIONS.at(-1)!.href).toBe(GITHUB_URL);
    expect(DASHBOARD_SECTIONS.map((s) => s.label)).toEqual(["Live spread", "Instruction", "Guardrails", "Ledger", "Issuers"]);
    for (const [sections, src] of [
      [LANDING_SECTIONS, landing() + read("components/landing-content.ts")],
      [DASHBOARD_SECTIONS, ["app/dashboard/page.tsx", "components/pool-spread-monitor.tsx", "components/instruction-box.tsx", "components/guardrail-checklist.tsx", "components/audit-ledger.tsx", "components/issuer-monitor.tsx"].map((f) => read(f)).join("\n")],
    ] as const) {
      for (const s of sections.filter((x) => x.href.startsWith("#"))) {
        expect(s.href).toMatch(/^#[a-z-]+$/);
        expect(src, s.href).toContain(`id="${s.href.slice(1)}"`);
        expect(s.label.split(" ").length).toBeLessThanOrEqual(3);
      }
    }
    expect(landing()).toContain("<SiteMenu sections={LANDING_SECTIONS} />");
    expect(header()).toContain("<SiteMenu sections={DASHBOARD_SECTIONS} />");
    expect(landing()).not.toContain("topnav--wide");
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
    expect(landing()).toContain("<ThemeToggle />");
    expect(header()).toContain("<ThemeToggle />");
  });

  it("the chart follows the theme and its hover box stays compact enough to fit a phone", () => {
    const chart = read("components/spread-chart.tsx");
    expect(chart).not.toMatch(/TOKENS\./);
    expect(chart).toContain('"var(--color-chart-gross)"');
    expect(chart).toContain("TOOLTIP_NAMES");
    expect(chart).toContain("allowEscapeViewBox={{ x: false, y: false }}");
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
