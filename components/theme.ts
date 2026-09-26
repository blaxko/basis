// The dashboard's colours, defined once. Every colour on the page comes
// from here: the root layout injects TOKENS as CSS variables
// (cssVariables()), globals.css uses only those variables, and the chart
// reads TOKENS directly. test/theme.test.ts fails on a hex colour anywhere
// else in app/ or components/, and checks every text/background pair
// below against WCAG AA.

// BNB Chain's brand colours, from bnbchain.org/en/brand-guidelines
// ("Colours", checked 2026-09-26). Colours only: the BNB Chain logo is not
// used anywhere (its use needs BNB Chain's approval and must not imply
// endorsement).
export const BRAND = {
  yellow: "#F0B90B", // Pantone 116C — primary accent
  nearBlack: "#0B0E11", // main background
  white: "#FFFFFF", // main text
} as const;

// The few extra colours a dark, data-dense UI needs, chosen to pass WCAG AA
// against the brand background (see CONTRAST_PAIRS).
export const SUPPORT = {
  surface: "#161A1E", // panels, one step up from the page background
  grey: "#A7AEB8", // secondary text; also "pending / warming up"
  lineGrey: "#848E9C", // chart zero line
  gridLine: "#2B3139", // chart grid (decorative)
  green: "#0ECB81", // pass / approved
  red: "#FF5A6E", // block / fail
} as const;

// What each colour means. Yellow is brand decoration only (accents, links,
// the primary button) — it never signals a state. Pass is green, block is
// red, and pending / warming up is neutral grey *plus* a dashed outline and
// an explicit label ([PENDING], WARMING UP), so it can't be mistaken for a
// pass, a block, or the brand colour.
export const TOKENS = {
  bg: BRAND.nearBlack,
  surface: SUPPORT.surface,
  text: BRAND.white,
  muted: SUPPORT.grey,
  border: BRAND.white,
  accent: BRAND.yellow,
  onAccent: BRAND.nearBlack, // text on yellow: never white
  link: BRAND.yellow,
  pass: SUPPORT.green,
  onPass: BRAND.nearBlack,
  fail: SUPPORT.red,
  onFail: BRAND.nearBlack, // white on this red is only 3.0:1
  pending: SUPPORT.grey,
  chartGross: BRAND.yellow, // dashed
  chartNet: BRAND.white, // solid, thicker
  chartZero: SUPPORT.lineGrey,
  chartBand: SUPPORT.red, // the "doesn't clear costs" band, at low opacity
  chartGrid: SUPPORT.gridLine,
  chartAxis: SUPPORT.grey,
} as const;

export type TokenName = keyof typeof TOKENS;

// Opacity of the red "doesn't clear costs" band over the panel surface.
export const CHART_BAND_OPACITY = 0.14;

const cssName = (name: string) => `--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ":root{--color-bg:#0B0E11;--color-on-accent:#0B0E11;…}"
export function cssVariables(): string {
  return `:root{${Object.entries(TOKENS)
    .map(([name, value]) => `${cssName(name)}:${value}`)
    .join(";")}}`;
}

// --- WCAG contrast ---------------------------------------------------------

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Alpha-blend a colour over a background (for the chart band).
export function blend(fg: string, bg: string, alpha: number): string {
  const p = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const f = p(fg);
  const b = p(bg);
  return "#" + f.map((x, i) => Math.round(x * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

// Every text-on-background pair the dashboard uses. Each must reach 4.5:1
// (WCAG AA, normal text). Disabled controls are dimmed and are exempt
// under WCAG, so they aren't listed.
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; where: string }> = [
  { fg: TOKENS.text, bg: TOKENS.bg, where: "page text; header; terminal feeds (Advisory Feed, Audit Ledger)" },
  { fg: TOKENS.text, bg: TOKENS.surface, where: "panel text; instruction input; chart tooltip" },
  { fg: TOKENS.muted, bg: TOKENS.bg, where: "secondary text on the page background: ledger meta lines, footer" },
  { fg: TOKENS.muted, bg: TOKENS.surface, where: "secondary text in panels: help text, check reasons, axis labels" },
  { fg: TOKENS.pending, bg: TOKENS.surface, where: "[PENDING] / [WARMING UP] marks and the WARMING UP badge" },
  { fg: TOKENS.pending, bg: TOKENS.bg, where: "the 'can't judge it yet' result under the instruction box" },
  { fg: TOKENS.pass, bg: TOKENS.surface, where: "[PASS] marks, APPROVED badge, positive net edge" },
  { fg: TOKENS.pass, bg: TOKENS.bg, where: "status dots and approved results on the page background" },
  { fg: TOKENS.fail, bg: TOKENS.surface, where: "[FAIL] marks, BLOCKED badge, negative net edge, error messages" },
  { fg: TOKENS.fail, bg: TOKENS.bg, where: "errors on the page background" },
  { fg: TOKENS.accent, bg: TOKENS.surface, where: "yellow text in panels: links, the 'Start here' accents" },
  { fg: TOKENS.accent, bg: TOKENS.bg, where: "yellow text on the page background: header links, chart legend" },
  { fg: TOKENS.onAccent, bg: TOKENS.accent, where: "near-black text on yellow: Send button, active killswitch button" },
  { fg: TOKENS.onPass, bg: TOKENS.pass, where: "near-black text on green: the LIVE data tag" },
  { fg: TOKENS.onFail, bg: TOKENS.fail, where: "near-black text on red: the active LIVE killswitch button (local only)" },
  { fg: TOKENS.chartBand, bg: blend(TOKENS.chartBand, TOKENS.surface, CHART_BAND_OPACITY), where: "the band's label 'below zero: doesn't clear costs'" },
  { fg: TOKENS.text, bg: blend(TOKENS.chartBand, TOKENS.surface, CHART_BAND_OPACITY), where: "the zero-line label where it sits over the band" },
];
