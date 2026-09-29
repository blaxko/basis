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
const LANDING_FILES = ["app/page.tsx", "components/landing-content.ts", "components/landing-live-reading.tsx", "components/live-reading-view.ts"];
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

  it("links both ways: the landing page's main button opens /app; the dashboard links home, How it works and GitHub", () => {
    expect(LANDING.hero.primary).toEqual({ label: "Open the dashboard", href: "/app" });
    expect(read("app/page.tsx")).toContain("LANDING.hero.primary.href");
    const header = read("components/header.tsx");
    expect(header).toContain('href="/"');
    expect(header).toContain('href="/#how"');
    expect(header).toContain("href={GITHUB_URL}");
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
  it("uses the one-liner as its headline", () => {
    expect(LANDING.hero.title).toBe("An arbitrage agent for tokenized stocks that knows when not to trade.");
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

  it("the six guardrails with their real limits, described as the details file does", () => {
    expect(LANDING.guardrails.map((g) => [g.check, g.limit])).toEqual([
      ["Price sanity and liquidity", "Minimum pool liquidity $1,000"],
      ["Market status", "—"],
      ["Reference price", "Within 2%"],
      ["Per-trade cap", "$500"],
      ["Daily cap", "$2,000"],
      ["Dry-run floor", "At least 98%"],
    ]);
    expect(landingText).toContain('A plain \\"market closed\\" does not block');
    expect(landingText).toContain("per UTC day");
    for (const wrong of [/truncat/i, /24-hour/i, /must report active/i, /confirms trading hours/i, /net realized/i, /\+41 bps/]) expect(landingText).not.toMatch(wrong);
  });

  it("figures that aren't live carry their date", () => {
    const issuers = JSON.stringify(LANDING.issuers);
    expect(issuers).toContain("104");
    expect(issuers).toContain("28 Sep 2026, 20:15 UTC");
    expect(issuers).toContain("498 of 5,780");
    expect(landingText).toContain("Monitor only: Basis doesn't trade across issuers");
  });

  it("the FAQ says plainly that Basis doesn't make money", () => {
    expect(LANDING.faq[0]!.q).toBe("Does Basis make money?");
    expect(LANDING.faq[0]!.a.startsWith("No.")).toBe(true);
  });

  it("the demo video is a placeholder until its URL is set, never a dead link", () => {
    expect(DEMO_VIDEO_URL).toBeNull();
    expect(read("app/page.tsx")).toContain("DEMO_VIDEO_URL ? (");
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
