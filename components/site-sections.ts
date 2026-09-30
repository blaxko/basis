// What each page's menu lists: short navigation names, never the section
// headlines. test/landing-and-app.test.ts checks every in-page link lands
// on a section that exists.
import { GITHUB_URL } from "./links";

export interface SiteSection {
  href: string;
  label: string;
}

export const LANDING_SECTIONS: readonly SiteSection[] = [
  { href: "#how", label: "How it works" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#findings", label: "Findings" },
  { href: "#faq", label: "FAQ" },
  { href: GITHUB_URL, label: "GitHub" },
];

export const DASHBOARD_SECTIONS: readonly SiteSection[] = [
  { href: "#spread", label: "Live spread" },
  { href: "#instruction", label: "Instruction" },
  { href: "#gate", label: "Guardrails" },
  { href: "#ledger", label: "Ledger" },
  { href: "#issuers", label: "Issuers" },
];
