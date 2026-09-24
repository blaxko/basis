import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basis",
  description: "Cross-pool gaps, counted only after every cost.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
