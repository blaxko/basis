import { Header } from "../components/header";
import { PoolSpreadMonitor } from "../components/pool-spread-monitor";
import { AdvisoryFeed } from "../components/advisory-feed";
import { GuardrailChecklist } from "../components/guardrail-checklist";
import { AuditLedger } from "../components/audit-ledger";

export default function Home() {
  return (
    <main className="dashboard">
      <Header />
      <div className="bento-grid">
        <PoolSpreadMonitor />
        <AdvisoryFeed />
        <GuardrailChecklist />
        <AuditLedger />
      </div>
    </main>
  );
}
