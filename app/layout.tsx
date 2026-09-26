import type { Metadata } from "next";
import "./globals.css";
import { cssVariables } from "../components/theme";

export const metadata: Metadata = {
  title: "Basis",
  description: "Cross-pool gaps, counted only after every cost.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The palette, from components/theme.ts — the only place colours are defined. */}
        <style>{cssVariables()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
