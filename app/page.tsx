import { cookies } from "next/headers";
import { Header } from "../components/header";
import { InstructionBox } from "../components/instruction-box";
import { StartHere } from "../components/start-here";
import { START_HERE_COOKIE } from "../components/start-here-content";
import { PoolSpreadMonitor } from "../components/pool-spread-monitor";
import { GuardrailChecklist } from "../components/guardrail-checklist";
import { AuditLedger } from "../components/audit-ledger";
import { SidebarNav } from "../components/sidebar-nav";
import { IssuerMonitor } from "../components/issuer-monitor";
import { publicReadOnlyFromEnv } from "../components/public-mode";

// Rendered per request: whether this is the public read-only demo, and
// whether the visitor dismissed Start here (cookie), are decided on the
// server, so the header, the Start here panel and the nav are right in the
// first paint and nothing moves once the page's data loads.
export const dynamic = "force-dynamic";

export default async function Home() {
  const status = { publicReadOnly: publicReadOnlyFromEnv(process.env.PUBLIC_READ_ONLY) };
  const dismissed = (await cookies()).get(START_HERE_COOKIE)?.value === "1";

  return (
    <div className="shell">
      <SidebarNav publicReadOnly={status.publicReadOnly} showStartHere={status.publicReadOnly && !dismissed} />
      <main className="dashboard">
        <Header publicReadOnly={status.publicReadOnly} />
        <StartHere status={status} dismissed={dismissed} />
        <div className="bento-grid">
          <InstructionBox />
          <PoolSpreadMonitor />
          <IssuerMonitor />
          <div className="gate-ledger">
            <GuardrailChecklist />
            <AuditLedger />
          </div>
        </div>
        <footer className="footer">Built on BNB Chain</footer>
      </main>
    </div>
  );
}
