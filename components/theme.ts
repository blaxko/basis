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

// Surfaces and greys measured from bnbchain.org's live CSS (computed
// styles, 2026-09-28): page #14151A, cards #181A1E, inner cards and
// hairlines #1E2026, body text #C4C5CB, secondary text #8C8F9B. The hover
// step and chart grid sit between those steps. Plus the state colours.
// Chosen to pass WCAG AA on every surface (see CONTRAST_PAIRS).
export const SUPPORT = {
  page: "#14151A", // page background
  subtle: "#1E2026", // inputs, chips, toggles, inner cards
  surface: "#181A1E", // panels and cards
  interactive: "#262830", // hover
  body: "#C4C5CB", // standard body text
  grey: "#8C8F9B", // secondary text: labels, help, axis
  pending: "#A7AEB8", // "pending / warming up / no call yet" (with dashes and a label)
  lineGrey: "#848E9C", // chart zero line
  gridLine: "#2A2D35", // chart grid (decorative)
  light: "#F7F7F8", // outline button border (bnbchain.org's secondary buttons)
  green: "#0ECB81", // pass / approved
  red: "#FF5A6E", // block / fail
} as const;

// Translucent tones for hairline borders and tinted badge backgrounds.
// Decorative only: never the only carrier of meaning, never behind text
// that isn't checked on the opaque surface beneath.
export const ALPHA = {
  hairline: "rgba(255,255,255,0.08)",
  hairlineStrong: "rgba(255,255,255,0.16)",
  accentTint: "rgba(240,185,11,0.10)",
  accentLine: "rgba(240,185,11,0.35)",
  passTint: "rgba(14,203,129,0.10)",
  passLine: "rgba(14,203,129,0.35)",
  failTint: "rgba(255,90,110,0.10)",
  failLine: "rgba(255,90,110,0.40)",
  // The landing page's decoration: the hero's liquid-glass card and top
  // bar, the light blobs behind them, and the background grid. The glass
  // fill is dense enough that text on it reads as on the surface colour.
  glassFill: "rgba(24,26,30,0.62)", // GLASS_FILL_ALPHA below,
  glassEdge: "rgba(255,255,255,0.14)",
  glassSheen: "rgba(255,255,255,0.10)",
  glassSpecular: "rgba(255,255,255,0.22)",
  barGlass: "rgba(20,21,26,0.72)",
  accentGlow: "rgba(240,185,11,0.26)", // ACCENT_GLOW_ALPHA below,
  accentGlowSoft: "rgba(240,185,11,0.08)",
  passGlow: "rgba(14,203,129,0.14)",
  gridLine: "rgba(255,255,255,0.045)",
  clear: "rgba(0,0,0,0)",
} as const;

// What each colour means. Yellow is brand decoration only (accents, links,
// the primary button) — it never signals a state. Pass is green, block is
// red, and pending / warming up is neutral grey *plus* a dashed outline and
// an explicit label ([PENDING], WARMING UP), so it can't be mistaken for a
// pass, a block, or the brand colour.
export const TOKENS = {
  bg: SUPPORT.page,
  subtle: SUPPORT.subtle,
  surface: SUPPORT.surface,
  interactive: SUPPORT.interactive,
  text: BRAND.white,
  body: SUPPORT.body,
  muted: SUPPORT.grey,
  border: BRAND.white,
  line: SUPPORT.subtle, // solid 1px hairlines: panel edges, top bar, footer
  light: SUPPORT.light,
  accent: BRAND.yellow,
  onAccent: BRAND.nearBlack, // text on yellow: never white
  link: BRAND.yellow,
  pass: SUPPORT.green,
  onPass: BRAND.nearBlack,
  fail: SUPPORT.red,
  onFail: BRAND.nearBlack, // white on this red is only 3.0:1
  pending: SUPPORT.pending,
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

// ":root{--color-bg:#0B0E11;--color-on-accent:#0B0E11;…;--color-hairline:rgba(…)}"
export function cssVariables(): string {
  return `:root{${[...Object.entries(TOKENS), ...Object.entries(ALPHA)]
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

// The hero's glass card at its brightest: the glass fill over the densest
// point of the yellow light blob behind it. Text on the card is checked
// on this as well as on the plain surface.
const GLASS_FILL_ALPHA = 0.62;
const ACCENT_GLOW_ALPHA = 0.26;
export const GLASS_OVER_GLOW = blend(SUPPORT.surface, blend(BRAND.yellow, SUPPORT.page, ACCENT_GLOW_ALPHA), GLASS_FILL_ALPHA);

// Every text-on-background pair the dashboard uses. Each must reach 4.5:1
// (WCAG AA, normal text). Disabled controls are dimmed and are exempt
// under WCAG, so they aren't listed.
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; where: string }> = [
  { fg: TOKENS.text, bg: TOKENS.bg, where: "page text and landing headings; the ledger's terminal viewport; the instruction input; outline buttons" },
  { fg: TOKENS.text, bg: TOKENS.surface, where: "panel headings, metric values, chart tooltip" },
  { fg: TOKENS.text, bg: TOKENS.subtle, where: "chip text; toggle labels; result box headline" },
  { fg: TOKENS.text, bg: TOKENS.interactive, where: "hovered rows and buttons" },
  { fg: TOKENS.body, bg: TOKENS.surface, where: "body text in panels: cost table, guardrail rows" },
  { fg: TOKENS.body, bg: TOKENS.bg, where: "ledger rows in the terminal viewport; landing body text" },
  { fg: TOKENS.body, bg: TOKENS.subtle, where: "status chips, example pills, result detail" },
  { fg: TOKENS.muted, bg: TOKENS.bg, where: "secondary text on the page background: status strip, footers, landing notes" },
  { fg: TOKENS.muted, bg: TOKENS.surface, where: "secondary text in panels: labels, help text, limits, axis labels" },
  { fg: TOKENS.muted, bg: TOKENS.subtle, where: "inactive mode buttons, chip labels" },
  { fg: TOKENS.muted, bg: TOKENS.interactive, where: "secondary text on hovered rows" },
  { fg: TOKENS.pending, bg: TOKENS.surface, where: "[PENDING] / [WARMING UP] marks and the WARMING UP badge" },
  { fg: TOKENS.pending, bg: TOKENS.bg, where: "the 'can't judge it yet' result under the instruction box" },
  { fg: TOKENS.pending, bg: TOKENS.subtle, where: "pending text in result boxes" },
  { fg: TOKENS.pass, bg: TOKENS.surface, where: "[PASS] marks, the LIVE tag, positive net edge" },
  { fg: TOKENS.pass, bg: TOKENS.bg, where: "positive values in the ledger" },
  { fg: TOKENS.pass, bg: TOKENS.subtle, where: "status dots' labels in the ribbon" },
  { fg: TOKENS.fail, bg: TOKENS.surface, where: "[FAIL] marks, BLOCKED badge, negative net edge, error messages" },
  { fg: TOKENS.fail, bg: TOKENS.bg, where: "negative values and errors in the ledger" },
  { fg: TOKENS.fail, bg: TOKENS.subtle, where: "errors in result boxes" },
  { fg: TOKENS.accent, bg: TOKENS.surface, where: "yellow text in panels and landing cards: links, step numbers, tags" },
  { fg: TOKENS.accent, bg: TOKENS.bg, where: "the prompt caret; links on the page background" },
  { fg: TOKENS.accent, bg: TOKENS.subtle, where: "yellow text in toggles and chips" },
  { fg: TOKENS.onAccent, bg: TOKENS.accent, where: "near-black text on yellow: primary buttons, Send, the active mode button" },
  { fg: TOKENS.onPass, bg: TOKENS.pass, where: "near-black text on green: the LIVE data tag" },
  { fg: TOKENS.onFail, bg: TOKENS.fail, where: "near-black text on red: the active LIVE killswitch button (local only)" },
  { fg: TOKENS.text, bg: GLASS_OVER_GLOW, where: "prices and net edge on the hero's glass card" },
  { fg: TOKENS.body, bg: GLASS_OVER_GLOW, where: "row labels on the hero's glass card" },
  { fg: TOKENS.muted, bg: GLASS_OVER_GLOW, where: "labels, time and footnote on the hero's glass card" },
  { fg: TOKENS.pass, bg: GLASS_OVER_GLOW, where: "positive net edge on the hero's glass card" },
  { fg: TOKENS.fail, bg: GLASS_OVER_GLOW, where: "costs and negative net edge on the hero's glass card" },
  { fg: TOKENS.chartBand, bg: blend(TOKENS.chartBand, TOKENS.surface, CHART_BAND_OPACITY), where: "the band's label 'below zero: doesn't clear costs'" },
  { fg: TOKENS.text, bg: blend(TOKENS.chartBand, TOKENS.surface, CHART_BAND_OPACITY), where: "the zero-line label where it sits over the band" },
];
