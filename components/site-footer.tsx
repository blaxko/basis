import { LANDING } from "./landing-content";

// The footer of the landing page and of the four pages behind its menu:
// one line, in plain text.
export function SiteFooter() {
  return (
    <footer className="l-footer">
      <div className="l-wrap l-footer-inner">
        <div className="l-footer-name">{LANDING.footer.name}</div>
      </div>
    </footer>
  );
}
