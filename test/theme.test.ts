import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  BRAND,
  SUPPORT,
  TOKENS,
  LIGHT_TOKENS,
  CONTRAST_PAIRS,
  LIGHT_CONTRAST_PAIRS,
  GRAPHIC_PAIRS,
  LIGHT_GRAPHIC_PAIRS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  contrastRatio,
  relativeLuminance,
  cssVariables,
} from "../components/theme";

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
    expect(TOKENS.text).toBe(BRAND.white);
  });

  it("surfaces and greys are the ones measured on bnbchain.org (computed styles, 2026-09-28)", () => {
    expect(TOKENS.bg).toBe("#14151A");
    expect(TOKENS.surface).toBe("#181A1E");
    expect(TOKENS.subtle).toBe("#1E2026");
    expect(TOKENS.line).toBe("#1E2026");
    expect(TOKENS.body).toBe("#C4C5CB");
    expect(TOKENS.muted).toBe("#8C8F9B");
    expect(SUPPORT.light).toBe("#F7F7F8");
  });

  it("text on yellow is near-black in both themes; on red and green it is near-black in dark (white on the darker light-theme green and red)", () => {
    expect(TOKENS.onAccent).toBe(BRAND.nearBlack);
    expect(LIGHT_TOKENS.onAccent).toBe(BRAND.nearBlack);
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

describe("light theme", () => {
  it("has the same tokens as the dark theme", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(TOKENS).sort());
  });

  it("white or very light surfaces, near-black text", () => {
    for (const k of ["bg", "surface", "subtle", "interactive"] as const) expect(relativeLuminance(LIGHT_TOKENS[k]), k).toBeGreaterThan(0.75);
    expect(LIGHT_TOKENS.text).toBe(BRAND.nearBlack);
  });

  it("yellow only as a fill with dark text: never as text, links or thin lines", () => {
    expect(LIGHT_TOKENS.accent).toBe(BRAND.yellow);
    expect(LIGHT_TOKENS.onAccent).toBe(BRAND.nearBlack);
    for (const k of ["accentInk", "link", "text", "body", "muted", "light", "chartNet", "chartZero", "chartGrid", "chartAxis"] as const) {
      expect(LIGHT_TOKENS[k], k).not.toBe(BRAND.yellow);
    }
    // The CSS never uses the fill colour for text, borders or outlines.
    const css = readFileSync(join(root, "app", "globals.css"), "utf8");
    expect(css).not.toMatch(/(^|[^-])(color|border(-[a-z]+)?|outline|stroke):[^;]*var\(--color-accent\)/m);
  });

  it("the page follows the device, a remembered choice wins, and it is set before paint", () => {
    const css = cssVariables();
    expect(css).toContain("@media (prefers-color-scheme: light){:root:not([data-theme=\"dark\"]){");
    expect(css).toContain(":root[data-theme=\"light\"]{");
    expect(css).toContain("color-scheme:light");
    expect(THEME_INIT_SCRIPT).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    const layout = readFileSync(join(root, "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/<head>[\s\S]*THEME_INIT_SCRIPT[\s\S]*<\/head>/);
  });
});

describe("contrast (WCAG AA), both themes", () => {
  it.each(LIGHT_CONTRAST_PAIRS.map((p) => [p.where, p.fg, p.bg] as const))("light text, %s: %s on %s", (_where, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([...GRAPHIC_PAIRS.map((p) => ["dark", p.where, p.fg, p.bg] as const), ...LIGHT_GRAPHIC_PAIRS.map((p) => ["light", p.where, p.fg, p.bg] as const)])(
    "%s lines and icons, %s: %s on %s (3:1)",
    (_theme, _where, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
    }
  );
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

  it("both pages' footers say 'Built on BNB Chain' in plain text", () => {
    expect(readFileSync(join(root, "app", "dashboard", "page.tsx"), "utf8")).toContain('<footer className="footer">Basis · Built on BNB Chain');
    expect(readFileSync(join(root, "components", "landing-content.ts"), "utf8")).toContain('name: "Basis · Built on BNB Chain"');
  });
});
