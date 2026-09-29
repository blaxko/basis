import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cssVariables, LIGHT_TOKENS, THEME_INIT_SCRIPT, TOKENS } from "../components/theme";

// Fonts are self-hosted by next/font (downloaded at build time, served from
// this site) with size-adjusted fallbacks, so text doesn't jump when they
// load. Inter for UI text; JetBrains Mono for numbers, hashes and the ledger.
const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Basis",
  description: "An arbitrage agent for tokenized stocks that knows when not to trade.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: LIGHT_TOKENS.bg },
    { media: "(prefers-color-scheme: dark)", color: TOKENS.bg },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* The palette, both themes, from components/theme.ts — the only place colours are defined. */}
        <style>{cssVariables()}</style>
        {/* A remembered light/dark choice is applied before the page paints
            (no flash); without one, the CSS follows the device. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
