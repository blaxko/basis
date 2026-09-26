import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BRAND, TOKENS, CONTRAST_PAIRS, contrastRatio, cssVariables } from "../components/theme";

const root = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []
  );
}

describe("palette", () => {
  it("uses BNB Chain's three brand colours exactly (bnbchain.org/en/brand-guidelines)", () => {
    expect(BRAND).toEqual({ yellow: "#F0B90B", nearBlack: "#0B0E11", white: "#FFFFFF" });
    expect(TOKENS.accent).toBe(BRAND.yellow);
    expect(TOKENS.bg).toBe(BRAND.nearBlack);
    expect(TOKENS.text).toBe(BRAND.white);
  });

  it("text on yellow (and on red and green) is near-black, never white", () => {
    expect(TOKENS.onAccent).toBe(BRAND.nearBlack);
    expect(TOKENS.onPass).toBe(BRAND.nearBlack);
    expect(TOKENS.onFail).toBe(BRAND.nearBlack);
  });

  it("pending is neither pass, fail nor the brand yellow", () => {
    expect(new Set([TOKENS.pending, TOKENS.pass, TOKENS.fail, TOKENS.accent]).size).toBe(4);
    const css = readFileSync(join(root, "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.badge--warming \{[^}]*border-style: dashed/);
    expect(css).toMatch(/\.instruction-result--info \{[^}]*border-left-style: dashed/);
  });

  it("the chart's two lines and zero line are distinct colours", () => {
    expect(new Set([TOKENS.chartGross, TOKENS.chartNet, TOKENS.chartZero]).size).toBe(3);
  });
});

describe("colours are defined once", () => {
  it("no hex colour appears in app/ or components/ outside components/theme.ts", () => {
    const offenders: string[] = [];
    for (const f of [...files("app"), ...files("components")]) {
      if (f.endsWith(join("components", "theme.ts"))) continue;
      const hits = readFileSync(join(root, f), "utf8").match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hits) offenders.push(`${relative(root, join(root, f))}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("every --color-* variable the stylesheet or components use is defined by the theme", () => {
    const defined = new Set([...cssVariables().matchAll(/(--color-[a-z-]+):/g)].map((m) => m[1]));
    const used = new Set<string>();
    for (const f of [...files("app"), ...files("components")]) {
      for (const m of readFileSync(join(root, f), "utf8").matchAll(/var\((--color-[a-z-]+)\)/g)) used.add(m[1]!);
    }
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });

  it("the layout injects the theme's variables", () => {
    expect(readFileSync(join(root, "app", "layout.tsx"), "utf8")).toContain("<style>{cssVariables()}</style>");
    expect(cssVariables()).toContain("--color-on-accent:#0B0E11");
  });
});

describe("contrast (WCAG AA, 4.5:1 for normal text)", () => {
  it.each(CONTRAST_PAIRS.map((p) => [p.where, p.fg, p.bg] as const))("%s: %s on %s", (_where, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("the formula matches known values (white on black 21:1, identical colours 1:1)", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#F0B90B", "#F0B90B")).toBeCloseTo(1, 5);
  });
});

describe("brand usage rules", () => {
  it("no BNB Chain logo or image anywhere in the UI, and no 'Official' / 'Partner' wording", () => {
    for (const f of [...files("app"), ...files("components")]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).not.toMatch(/<img|<Image|\.svg["']|\.png["']/);
      expect(src, f).not.toMatch(/\b(Official|Partner(ing)?|Collaborating)\b/);
    }
  });

  it("the footer says 'Built on BNB Chain' in plain text", () => {
    expect(readFileSync(join(root, "app", "page.tsx"), "utf8")).toContain('<footer className="footer">Built on BNB Chain</footer>');
  });
});
