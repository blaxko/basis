import type { Metadata } from "next";
import { Header } from "../../components/header";
import { InstructionBox } from "../../components/instruction-box";
import { PoolSpreadMonitor } from "../../components/pool-spread-monitor";
import { GuardrailChecklist } from "../../components/guardrail-checklist";
import { AuditLedger } from "../../components/audit-ledger";
import { IssuerMonitor } from "../../components/issuer-monitor";
import { publicReadOnlyFromEnv } from "../../components/public-mode";

export const metadata: Metadata = { title: "Basis · Dashboard" };

// Served at /app (next.config.ts rewrites /app here). Rendered per
// request: whether this is the public read-only demo is
// decided on the server, so the header is right in the first paint.
export const dynamic = "force-dynamic";

// The dashboard shows only what's live and working; everything that
// explains lives on the landing page (/). Wide screens: the live reading
// and the ledger on the left, the instruction box and the gate on the
// right, the issuer monitor across. Phones: one column in that order.
export default function Dashboard() {
  const publicReadOnly = publicReadOnlyFromEnv(process.env.PUBLIC_READ_ONLY);

  return (
    <>
      <Header publicReadOnly={publicReadOnly} />
      <main className="dashboard">
        <div className="dash-grid">
          <PoolSpreadMonitor />
          <div className="dash-side">
            <InstructionBox />
            <GuardrailChecklist />
          </div>
          <AuditLedger />
          <IssuerMonitor />
        </div>
      </main>
      <footer className="footer">Basis · Built on BNB Chain · Not financial advice.</footer>
    </>
  );
}
