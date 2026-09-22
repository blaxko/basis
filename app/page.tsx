import { Header } from "../components/header";
import { NavSpreadMonitor } from "../components/nav-spread-monitor";
import { AdvisoryFeed } from "../components/advisory-feed";
import { GuardrailChecklist } from "../components/guardrail-checklist";
import { AuditLedger } from "../components/audit-ledger";

export default function Home() {
  return (
    <main className="dashboard">
      <Header />
      <div className="bento-grid">
        <NavSpreadMonitor />
        <AdvisoryFeed />
        <GuardrailChecklist />
        <AuditLedger />
      </div>
    </main>
  );
}
