import "../landing.css";
import { LandingMotion, MOTION_BOOT } from "../../components/landing-motion";
import { PageBackdrop } from "../../components/landing-visuals";
import { SiteHeader } from "../../components/site-header";
import { SiteFooter } from "../../components/site-footer";

// The landing page and the four pages behind its menu (How it works,
// Guardrails, Findings, FAQ) share this layout: the header, the footer,
// the glass backdrop and the motion. The dashboard (app/dashboard) is
// outside this group and keeps its own header and styles.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing">
      <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      <LandingMotion />
      <PageBackdrop />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
