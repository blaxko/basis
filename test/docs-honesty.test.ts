import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

// Claims a sceptical judge could catch, found by the 2026-09-26
// self-assessment. Each phrase below was in the docs and was untrue of
// the code or the live site; the required ones are what's true today.

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}`);
  if (start === -1) throw new Error(`no section "${heading}"`);
  const next = doc.indexOf("\n## ", start + 4);
  return doc.slice(start, next === -1 ? undefined : next);
}

describe("PRD matches the code and the live site", () => {
  const prd = read("docs/PRD.md");

  it("§2: no Wallet Skills / Agent Studio use cases (neither is used)", () => {
    const s = section(prd, "2. Target Users");
    expect(s).not.toMatch(/Wallet Skills|Agent Studio/);
  });

  it("§7: the architecture diagram describes the cross-pool design, not the rejected NAV thesis", () => {
    const s = section(prd, "7. System Architecture");
    for (const stale of ["price-return", "total-return", "Dividend calendar", "NAV-equivalent"]) expect(s).not.toContain(stale);
    for (const now of ["PancakeSwap V3", "aggregator/quote", "rwa/underlying-market", "pre-transaction/simulate", "broadcast-transaction"]) expect(s).toContain(now);
  });

  it("§8: Wallet Skills isn't listed as part of the stack", () => {
    expect(section(prd, "8. Recommended Stack")).not.toMatch(/Wallet Skills\*{0,2} — natural-language execution surface/);
  });

  it("§9: badges and one-liner match the dashboard", () => {
    const s = section(prd, "9. Design & UI");
    expect(s).not.toContain("total-return noise");
    expect(s).toContain("GUARDRAILS PASSED · NOT SENT");
    expect(prd).not.toMatch(/\*\*One-liner:\*\* Trading the real spread, not the total-return noise/);
  });

  it("§11 and §13: no NAV chart, dividend-drift tests or Agentic Wallet integration", () => {
    for (const h of ["11. Build Steps", "13. Repository Expectations"]) {
      const s = section(prd, h);
      for (const stale of ["NAV", "dividend-drift", "Agentic Wallet integration", "dividend calendar"]) expect(s).not.toContain(stale);
    }
  });

  it("§7 and §12: the ledger is described as it's kept (compacted runs), not as append-only", () => {
    expect(prd).not.toMatch(/append-only/i);
    const rule = section(prd, "12. Technical Correctness Rules (Non-Negotiable)");
    expect(rule).toMatch(/compact/i);
    expect(rule).toContain("5,000");
    expect(read("docs/how-to-use.md")).toMatch(/one row per run|folded into one row|compact/i);
  });

  it("§9.3 describes the terminal redesign, not the old neo-brutalist style", () => {
    const s = section(prd, "9. Design & UI");
    for (const stale of ["Neo-brutalism", "Hard white borders", "hard-offset yellow shadows", "Bento UI"]) expect(s).not.toContain(stale);
    for (const now of ["hairline", "JetBrains Mono", "Inter", "#F0B90B", "prefers-reduced-motion", "Cost breakdown"]) expect(s).toContain(now);
  });

  it("the issuer monitor panel is documented (PRD §9.2, how-to-use)", () => {
    expect(section(prd, "9. Design & UI")).toContain("Issuer monitor");
    const howTo = read("docs/how-to-use.md");
    expect(howTo).toContain("### Issuer monitor");
    expect(howTo).toContain("Monitor only: Basis doesn't trade across issuers");
    expect(howTo).toMatch(/per share/);
    expect(howTo).toMatch(/xStocks[^\n]*not included/);
    // "would clear costs" only from fresh quotes: the limit is documented
    expect(howTo).toMatch(/both of its quotes are at most 60 s old/);
    expect(section(prd, "9. Design & UI")).toMatch(/at most 60 s old/);
  });

  it("how-to-use covers the redesigned panels", () => {
    const howTo = read("docs/how-to-use.md");
    for (const now of ["Cost breakdown", "Export CSV", "Limit:", "Sell $50 of MSFT", "Advisory Feed", "sidebar"]) expect(howTo).toContain(now);
    expect(howTo).not.toContain("**Normal: empty**");
  });

  it("§14: proposals are template text, not Groq", () => {
    expect(section(prd, "14. Judging Criteria Alignment")).not.toContain("Plain-English proposals via Groq");
  });

  it("§16: says which endpoints actually run on the deployed site, and that the Transaction API only ran in the local test", () => {
    const s = section(prd, "16. Acceptance Criteria — Definition of Done");
    expect(s).not.toContain("in every dry-run and before every send");
    expect(s).toMatch(/deployed site[^\n]*aggregator\/quote[^\n]*rwa\/underlying-market/);
    expect(s).toMatch(/Transaction API[^\n]*(only|local)/);
    // Done and verified items are ticked.
    expect(s).toContain("- [x] **A public repo");
    expect(s).toContain("- [x] **A deployed link");
    expect(s).toContain("- [x] **Build requirement");
  });
});

describe("README and how-to-use match the code and the live site", () => {
  const readme = read("README.md");
  const howTo = read("docs/how-to-use.md");

  it("README: the Transaction API claim says where it actually ran", () => {
    expect(readme).not.toContain("in every dry-run and before every send");
    expect(readme).toMatch(/deployed site[^\n]*aggregator\/quote[^\n]*rwa\/underlying-market/i);
    expect(readme).toMatch(/Transaction API[^\n]*(local|execution test)/);
  });

  it("README and PRD list the cross-issuer recorder's calls among what runs on the deployed site", () => {
    const prd = read("docs/PRD.md");
    for (const doc of [readme, prd]) {
      expect(doc).toContain("rwa/price");
      expect(doc).toContain("/api/issuers");
      expect(doc).toMatch(/Monitor only: Basis doesn't trade across issuers/);
    }
  });

  it("how-to-use: the round trip paid one pool's fee twice, not 'the two pools' fees'", () => {
    expect(howTo).not.toContain("(the two pools' fees)");
  });

  it("how-to-use: wording of results, badges and ledger rows is today's", () => {
    expect(howTo).not.toContain("Approved by all guardrails");
    expect(howTo).not.toContain("guardrail: APPROVED");
    expect(howTo).not.toContain("every header chip with a green dot");
    expect(howTo).toContain("Guardrails passed · not sent: no positive edge");
    expect(howTo).toContain("GUARDRAILS PASSED · NOT SENT");
    expect(howTo).toContain("sells aren't supported");
    expect(howTo).toContain("no calls yet");
  });
});

describe("the demo video link is updated in one step", () => {
  const MARK = /<!-- demo-video -->([\s\S]*?)<!-- \/demo-video -->/;

  it("README and how-to-use each have exactly one marked video spot, matching start-here-content.ts", () => {
    const content = read("components/start-here-content.ts");
    const url = content.match(/DEMO_VIDEO_URL: string \| null = (null|"([^"]+)")/);
    expect(url).not.toBeNull();
    for (const doc of [read("README.md"), read("docs/how-to-use.md")]) {
      expect(doc.match(new RegExp(MARK.source, "g"))).toHaveLength(1);
      const inner = doc.match(MARK)![1]!;
      if (url![1] === "null") expect(inner).toContain("coming soon");
      else expect(inner).toContain(url![2]);
    }
  });

  it("`npm run set-demo-video <url>` updates all three places", () => {
    const dir = mkdtempSync(join(tmpdir(), "basis-video-"));
    for (const f of ["README.md", "docs/how-to-use.md", "components/start-here-content.ts"]) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      copyFileSync(join(ROOT, f), join(dir, f));
    }
    const url = "https://youtu.be/EXAMPLE123";
    execFileSync(process.execPath, [join(ROOT, "scripts/set-demo-video.mjs"), url, "--root", dir]);
    expect(readFileSync(join(dir, "components/start-here-content.ts"), "utf8")).toContain(`DEMO_VIDEO_URL: string | null = "${url}";`);
    for (const f of ["README.md", "docs/how-to-use.md"]) {
      const inner = readFileSync(join(dir, f), "utf8").match(MARK)![1]!;
      expect(inner).toContain(`](${url})`);
      expect(inner).not.toContain("coming soon");
    }
    expect(JSON.parse(read("package.json")).scripts["set-demo-video"]).toBe("node scripts/set-demo-video.mjs");
  });
});
