import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basis",
  description: "Trading the real spread, not the total-return noise.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
