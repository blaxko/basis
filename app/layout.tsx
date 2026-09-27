import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cssVariables, TOKENS } from "../components/theme";

// Fonts are self-hosted by next/font (downloaded at build time, served from
// this site) with size-adjusted fallbacks, so text doesn't jump when they
// load. Inter for UI text; JetBrains Mono for numbers, hashes and the ledger.
const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Basis",
  description: "Cross-pool gaps, counted only after every cost.",
};

export const viewport: Viewport = { themeColor: TOKENS.bg };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        {/* The palette, from components/theme.ts — the only place colours are defined. */}
        <style>{cssVariables()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
