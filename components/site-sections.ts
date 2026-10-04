// What each menu lists. The landing page and its four pages share one
// menu of pages; the dashboard's menu is its own panels (hash links).
// Kept free of page text so the dashboard's bundle stays small:
// test/site-pages.test.ts checks these paths against the pages' own.
import { GITHUB_URL } from "./links";

export interface SiteSection {
  href: string;
  label: string;
  // Leaves the site: opens in a new tab and says so.
  external?: boolean;
}

export const SITE_PAGES: readonly SiteSection[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/guardrails", label: "Guardrails" },
  { href: "/findings", label: "Findings" },
  { href: "/faq", label: "FAQ" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];

export const DASHBOARD_SECTIONS: readonly SiteSection[] = [
  { href: "#spread", label: "Live spread" },
  { href: "#instruction", label: "Instruction" },
  { href: "#gate", label: "Guardrails" },
  { href: "#ledger", label: "Ledger" },
  { href: "#issuers", label: "Issuers" },
];
