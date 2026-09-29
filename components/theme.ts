// The site's colours, defined once, for both themes. Every colour on the
// page comes from here: the root layout injects the tokens as CSS
// variables (cssVariables()), globals.css and the chart use only those
// variables. test/theme.test.ts fails on a hex colour anywhere else in
// app/ or components/, and checks every text/background pair below
// against WCAG AA in both themes.

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

// The light theme's own colours: white and very light surfaces with
// near-black text. Yellow stays a fill only (with near-black text on it);
// text, links and thin lines that are yellow in the dark theme are
// near-black here. Green, red and the chart's gross-gap gold are darker so
// they reach AA on white (4.5:1 for text, 3:1 for lines and icons).
export const LIGHT = {
  page: "#F4F5F7",
  subtle: "#EEF0F3",
  surface: "#FFFFFF",
  interactive: "#E4E7EB",
  body: "#2B3038",
  grey: "#5B6270",
  pending: "#555C69",
  lineGrey: "#6B7280",
  gridLine: "#E1E4E8",
  line: "#E1E4E8",
  green: "#05744A",
  red: "#C3202F",
  gold: "#8C6400", // the chart's gross-gap line
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

// The same tones for the light theme. The glass is white at the same
// density, over softer yellow light; its edges and hairlines are dark;
// "accentLine" (thin lines) is near-black, never yellow, on light.
export const LIGHT_ALPHA: { [K in keyof typeof ALPHA]: string } = {
  hairline: "rgba(11,14,17,0.08)",
  hairlineStrong: "rgba(11,14,17,0.16)",
  accentTint: "rgba(240,185,11,0.16)",
  accentLine: "rgba(11,14,17,0.28)",
  passTint: "rgba(5,116,74,0.08)",
  passLine: "rgba(5,116,74,0.35)",
  failTint: "rgba(195,32,47,0.07)",
  failLine: "rgba(195,32,47,0.40)",
  glassFill: "rgba(255,255,255,0.62)", // GLASS_FILL_ALPHA below
  glassEdge: "rgba(11,14,17,0.10)",
  glassSheen: "rgba(255,255,255,0.55)",
  glassSpecular: "rgba(255,255,255,0.85)",
  barGlass: "rgba(244,245,247,0.78)",
  accentGlow: "rgba(240,185,11,0.22)", // LIGHT_ACCENT_GLOW_ALPHA below
  accentGlowSoft: "rgba(240,185,11,0.09)",
  passGlow: "rgba(5,116,74,0.08)",
  gridLine: "rgba(11,14,17,0.05)",
  clear: "rgba(255,255,255,0)",
};

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
  accent: BRAND.yellow, // fills: primary buttons, the active mode
  accentInk: BRAND.yellow, // yellow as text, focus rings and thin lines (dark theme only)
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

export const LIGHT_TOKENS: { [K in TokenName]: string } = {
  bg: LIGHT.page,
  subtle: LIGHT.subtle,
  surface: LIGHT.surface,
  interactive: LIGHT.interactive,
  text: BRAND.nearBlack,
  body: LIGHT.body,
  muted: LIGHT.grey,
  border: BRAND.nearBlack,
  line: LIGHT.line,
  light: BRAND.nearBlack, // outline buttons: a dark outline on light
  accent: BRAND.yellow, // fills only, always with near-black text
  accentInk: BRAND.nearBlack, // never yellow text or thin lines on light
  onAccent: BRAND.nearBlack,
  link: BRAND.nearBlack, // links stay underlined
  pass: LIGHT.green,
  onPass: BRAND.white, // near-black on this darker green is under 4.5:1
  fail: LIGHT.red,
  onFail: BRAND.white,
  pending: LIGHT.pending,
  chartGross: LIGHT.gold,
  chartNet: BRAND.nearBlack,
  chartZero: LIGHT.lineGrey,
  chartBand: LIGHT.red,
  chartGrid: LIGHT.gridLine,
  chartAxis: LIGHT.grey,
};

export type ThemeName = "dark" | "light";

// Opacity of the red "doesn't clear costs" band over the panel surface.
export const CHART_BAND_OPACITY = 0.14;

// A visitor's manual choice, remembered in their browser. Without one the
// site follows the device (prefers-color-scheme).
export const THEME_STORAGE_KEY = "basis.theme";

// Runs in <head> before the page paints, so a remembered choice never
// flashes the other theme first. The device default needs no script: the
// CSS below follows prefers-color-scheme.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const cssName = (name: string) => `--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const declarations = (tokens: Record<string, string>, alpha: Record<string, string>, scheme: ThemeName) =>
  [...Object.entries(tokens), ...Object.entries(alpha)].map(([name, value]) => `${cssName(name)}:${value}`).join(";") + `;color-scheme:${scheme}`;

// Dark by default; light when the device prefers it (unless the visitor
// chose dark), or when the visitor chose light.
export function cssVariables(): string {
  const dark = declarations(TOKENS, ALPHA, "dark");
  const light = declarations(LIGHT_TOKENS, LIGHT_ALPHA, "light");
  return `:root{${dark}}@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${light}}}:root[data-theme="light"]{${light}}`;
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

// The landing page's glass (the hero card, the cards, the guardrails
// table and the FAQ) at its brightest: the glass fill over the densest
// point of a yellow light blob behind it. Text on the glass is checked on
// this as well as on the plain surface.
const GLASS_FILL_ALPHA = 0.62;
const ACCENT_GLOW_ALPHA = 0.26;
const LIGHT_ACCENT_GLOW_ALPHA = 0.22;
export const GLASS_OVER_GLOW = blend(SUPPORT.surface, blend(BRAND.yellow, SUPPORT.page, ACCENT_GLOW_ALPHA), GLASS_FILL_ALPHA);
export const LIGHT_GLASS_OVER_GLOW = blend(LIGHT.surface, blend(BRAND.yellow, LIGHT.page, LIGHT_ACCENT_GLOW_ALPHA), GLASS_FILL_ALPHA);

type Tokens = { [K in TokenName]: string };
type Pair = { fg: string; bg: string; where: string };

// Every text-on-background pair the site uses. Each must reach 4.5:1
// (WCAG AA, normal text). Disabled controls are dimmed and are exempt
// under WCAG, so they aren't listed.
function textPairs(T: Tokens, glass: string): Pair[] {
  return [
    { fg: T.text, bg: T.bg, where: "page text and landing headings; the ledger's terminal viewport; the instruction input; outline buttons" },
    { fg: T.text, bg: T.surface, where: "panel headings, metric values, chart tooltip, the menu" },
    { fg: T.text, bg: T.subtle, where: "chip text; toggle labels; result box headline" },
    { fg: T.text, bg: T.interactive, where: "hovered rows, buttons and menu items" },
    { fg: T.body, bg: T.surface, where: "body text in panels: cost table, guardrail rows" },
    { fg: T.body, bg: T.bg, where: "ledger rows in the terminal viewport; landing body text" },
    { fg: T.body, bg: T.subtle, where: "status chips, example pills, result detail" },
    { fg: T.muted, bg: T.bg, where: "secondary text on the page background: status strip, footers, landing notes" },
    { fg: T.muted, bg: T.surface, where: "secondary text in panels: labels, help text, limits, axis labels" },
    { fg: T.muted, bg: T.subtle, where: "inactive mode buttons, chip labels" },
    { fg: T.muted, bg: T.interactive, where: "secondary text on hovered rows" },
    { fg: T.pending, bg: T.surface, where: "[PENDING] / [WARMING UP] marks and the WARMING UP badge" },
    { fg: T.pending, bg: T.bg, where: "the 'can't judge it yet' result under the instruction box" },
    { fg: T.pending, bg: T.subtle, where: "pending text in result boxes" },
    { fg: T.pass, bg: T.surface, where: "[PASS] marks, the LIVE tag, positive net edge" },
    { fg: T.pass, bg: T.bg, where: "positive values in the ledger" },
    { fg: T.pass, bg: T.subtle, where: "status dots' labels in the ribbon" },
    { fg: T.fail, bg: T.surface, where: "[FAIL] marks, BLOCKED badge, negative net edge, error messages" },
    { fg: T.fail, bg: T.bg, where: "negative values and errors in the ledger" },
    { fg: T.fail, bg: T.subtle, where: "errors in result boxes" },
    { fg: T.accentInk, bg: T.surface, where: "accent text in panels and landing cards: step numbers, tags" },
    { fg: T.accentInk, bg: T.bg, where: "the prompt caret on the page background" },
    { fg: T.accentInk, bg: T.subtle, where: "accent text in toggles and chips" },
    { fg: T.link, bg: T.bg, where: "links on the page background" },
    { fg: T.link, bg: T.surface, where: "links in panels" },
    { fg: T.onAccent, bg: T.accent, where: "text on yellow: primary buttons, Send, the active mode button" },
    { fg: T.onPass, bg: T.pass, where: "text on green: the LIVE data tag" },
    { fg: T.onFail, bg: T.fail, where: "text on red: the active LIVE mode button (local only)" },
    { fg: T.text, bg: glass, where: "prices and net edge on the hero's glass card; headings and values on glass cards" },
    { fg: T.body, bg: glass, where: "row labels on the hero's glass card; body text on glass cards, the table and the FAQ" },
    { fg: T.muted, bg: glass, where: "labels, time and footnote on the hero's glass card; table headers and labels on glass" },
    { fg: T.accentInk, bg: glass, where: "step numbers and tags on glass cards" },
    { fg: T.pass, bg: glass, where: "positive net edge on the hero's glass card" },
    { fg: T.fail, bg: glass, where: "costs and negative net edge on the hero's glass card" },
    { fg: T.chartBand, bg: blend(T.chartBand, T.surface, CHART_BAND_OPACITY), where: "the band's label 'below zero: doesn't clear costs'" },
    { fg: T.text, bg: blend(T.chartBand, T.surface, CHART_BAND_OPACITY), where: "the zero-line label where it sits over the band" },
  ];
}

// Lines and icons (WCAG 1.4.11, 3:1): the chart's lines, status dots, the
// focus ring and the header's icon buttons.
function graphicPairs(T: Tokens): Pair[] {
  return [
    { fg: T.chartGross, bg: T.surface, where: "the chart's gross-gap line" },
    { fg: T.chartNet, bg: T.surface, where: "the chart's net-edge line" },
    { fg: T.chartZero, bg: T.surface, where: "the chart's zero line" },
    { fg: T.chartNet, bg: blend(T.chartBand, T.surface, CHART_BAND_OPACITY), where: "the net-edge line over the red band" },
    { fg: T.pass, bg: T.bg, where: "green status dots" },
    { fg: T.fail, bg: T.bg, where: "red status dots" },
    { fg: T.pending, bg: T.bg, where: "grey dashed status dots" },
    { fg: T.accentInk, bg: T.bg, where: "the focus ring" },
    { fg: T.text, bg: T.bg, where: "the theme and menu icons" },
    { fg: T.light, bg: T.bg, where: "outline button borders" },
  ];
}

export const CONTRAST_PAIRS: ReadonlyArray<Pair> = textPairs(TOKENS, GLASS_OVER_GLOW);
export const LIGHT_CONTRAST_PAIRS: ReadonlyArray<Pair> = textPairs(LIGHT_TOKENS, LIGHT_GLASS_OVER_GLOW);
export const GRAPHIC_PAIRS: ReadonlyArray<Pair> = graphicPairs(TOKENS);
export const LIGHT_GRAPHIC_PAIRS: ReadonlyArray<Pair> = graphicPairs(LIGHT_TOKENS);
