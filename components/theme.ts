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

// The extra colours a dark, data-dense terminal needs: three slate-tinted
// surface steps above the brand near-black, two text greys, and the state
// colours. Chosen to pass WCAG AA on every surface (see CONTRAST_PAIRS).
export const SUPPORT = {
  subtle: "#0E131F", // sidebar, inputs, grouped strips
  surface: "#121824", // panels
  interactive: "#1A2234", // hover, active nav item
  body: "#CBD5E1", // standard body text
  grey: "#94A3B8", // secondary text: labels, help, axis
  pending: "#A7AEB8", // "pending / warming up / no call yet" (with dashes and a label)
  lineGrey: "#848E9C", // chart zero line
  gridLine: "#232B3A", // chart grid (decorative)
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
} as const;

// What each colour means. Yellow is brand decoration only (accents, links,
// the primary button) — it never signals a state. Pass is green, block is
// red, and pending / warming up is neutral grey *plus* a dashed outline and
// an explicit label ([PENDING], WARMING UP), so it can't be mistaken for a
// pass, a block, or the brand colour.
export const TOKENS = {
  bg: BRAND.nearBlack,
  subtle: SUPPORT.subtle,
  surface: SUPPORT.surface,
  interactive: SUPPORT.interactive,
  text: BRAND.white,
  body: SUPPORT.body,
  muted: SUPPORT.grey,
  border: BRAND.white,
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

// Every text-on-background pair the dashboard uses. Each must reach 4.5:1
// (WCAG AA, normal text). Disabled controls are dimmed and are exempt
// under WCAG, so they aren't listed.
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; where: string }> = [
  { fg: TOKENS.text, bg: TOKENS.bg, where: "page text; the ledger's terminal viewport; the instruction input" },
  { fg: TOKENS.text, bg: TOKENS.surface, where: "panel headings, metric values, chart tooltip" },
  { fg: TOKENS.text, bg: TOKENS.subtle, where: "sidebar and ribbon text; result box headline" },
  { fg: TOKENS.text, bg: TOKENS.interactive, where: "hovered rows, the active nav item" },
  { fg: TOKENS.body, bg: TOKENS.surface, where: "body text in panels: cost table, guardrail rows" },
  { fg: TOKENS.body, bg: TOKENS.bg, where: "ledger rows in the terminal viewport" },
  { fg: TOKENS.body, bg: TOKENS.subtle, where: "status chips, example pills, result detail" },
  { fg: TOKENS.muted, bg: TOKENS.bg, where: "secondary text on the page background: ledger timestamps, footer" },
  { fg: TOKENS.muted, bg: TOKENS.surface, where: "secondary text in panels: labels, help text, limits, axis labels" },
  { fg: TOKENS.muted, bg: TOKENS.subtle, where: "inactive killswitch buttons, nav items, sidebar footer" },
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
  { fg: TOKENS.accent, bg: TOKENS.surface, where: "yellow text in panels: links, step numbers" },
  { fg: TOKENS.accent, bg: TOKENS.bg, where: "the prompt caret on the input" },
  { fg: TOKENS.accent, bg: TOKENS.subtle, where: "yellow text in the sidebar" },
  { fg: TOKENS.onAccent, bg: TOKENS.accent, where: "near-black text on yellow: Send button, active killswitch button" },
  { fg: TOKENS.onPass, bg: TOKENS.pass, where: "near-black text on green: the LIVE data tag" },
  { fg: TOKENS.onFail, bg: TOKENS.fail, where: "near-black text on red: the active LIVE killswitch button (local only)" },
  { fg: TOKENS.chartBand, bg: blend(TOKENS.chartBand, TOKENS.surface, CHART_BAND_OPACITY), where: "the band's label 'below zero: doesn't clear costs'" },
  { fg: TOKENS.text, bg: blend(TOKENS.chartBand, TOKENS.surface, CHART_BAND_OPACITY), where: "the zero-line label where it sits over the band" },
];
