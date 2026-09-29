// What each page's menu lists: that page's own sections, nothing else.
// test/landing-and-app.test.ts checks every id exists on its page.

export interface SiteSection {
  href: string;
  label: string;
}

export const LANDING_SECTIONS: readonly SiteSection[] = [
  { href: "#problem", label: "A price gap isn't a profit" },
  { href: "#how", label: "The five steps" },
  { href: "#guardrails", label: "The six guardrails" },
  { href: "#findings", label: "What was tested" },
  { href: "#issuers", label: "Across issuers" },
  { href: "#limits", label: "What it won't do" },
  { href: "#faq", label: "Questions" },
];

export const DASHBOARD_SECTIONS: readonly SiteSection[] = [
  { href: "#spread", label: "Live reading" },
  { href: "#instruction", label: "Instruction" },
  { href: "#gate", label: "Guardrail Gate" },
  { href: "#ledger", label: "Audit Ledger" },
  { href: "#issuers", label: "Issuer monitor" },
];
