import { LANDING } from "./landing-content";
import { SiteMenu } from "./site-menu";
import { SITE_PAGES } from "./site-sections";
import { ThemeToggle } from "./theme-toggle";

// The header of the landing page and of the four pages behind its menu:
// the Basis wordmark (home, the way back to the overview), the dashboard
// button, the light/dark switch and the menu of pages. Server-rendered; the
// switch and the menu are the only client parts.
export function SiteHeader() {
  return (
    <header className="topbar">
      <div className="topbar-inner topbar-inner--landing">
        <a className="wordmark" href="/">
          Basis
        </a>
        <div className="topbar-actions">
          {/* The full label, or "Dashboard" on the narrowest phones; the
              link's name is the full label either way. */}
          <a className="btn btn--primary topbar-cta" href={LANDING.hero.primary.href} aria-label={LANDING.hero.primary.label}>
            <span className="cta-long">{LANDING.hero.primary.label}</span>
            <span className="cta-short">Dashboard</span>
          </a>
          <ThemeToggle />
          <SiteMenu sections={SITE_PAGES} label="Pages" />
        </div>
      </div>
    </header>
  );
}
