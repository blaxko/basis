// Section links: each jumps to a real panel on this page (no other pages
// exist). A left rail on wide screens; a horizontal strip on phones.
const SECTIONS: ReadonlyArray<{ href: string; label: string; onlyWithStartHere?: boolean }> = [
  { href: "#instruction", label: "Instruction" },
  { href: "#spread", label: "Spread monitor" },
  { href: "#costs", label: "Cost breakdown" },
  { href: "#issuers", label: "Issuer monitor" },
  { href: "#gate", label: "Guardrail gate" },
  { href: "#ledger", label: "Audit ledger" },
  { href: "#start", label: "How it works", onlyWithStartHere: true },
];

export function SidebarNav({ publicReadOnly, showStartHere }: { publicReadOnly: boolean; showStartHere: boolean }) {
  return (
    <nav className="sidebar" aria-label="Sections">
      <a className="sidebar-brand" href="#top">
        Basis
        <span className="sidebar-brand-sub mono">MSFTB · BNB Chain</span>
      </a>
      <ul className="sidebar-links">
        {SECTIONS.filter((s) => !s.onlyWithStartHere || showStartHere).map((s) => (
          <li key={s.href}>
            <a href={s.href}>{s.label}</a>
          </li>
        ))}
      </ul>
      {publicReadOnly && <p className="sidebar-foot mono">Public demo · read-only</p>}
    </nav>
  );
}
