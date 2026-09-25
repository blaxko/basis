import { Header } from "../components/header";
import { InstructionBox } from "../components/instruction-box";
import { StartHere } from "../components/start-here";
import { PoolSpreadMonitor } from "../components/pool-spread-monitor";
import { AdvisoryFeed } from "../components/advisory-feed";
import { GuardrailChecklist } from "../components/guardrail-checklist";
import { AuditLedger } from "../components/audit-ledger";

export default function Home() {
  return (
    <main className="dashboard">
      <Header />
      <StartHere />
      <div className="bento-grid">
        <InstructionBox />
        <PoolSpreadMonitor />
        <AdvisoryFeed />
        <GuardrailChecklist />
        <AuditLedger />
      </div>
    </main>
  );
}
