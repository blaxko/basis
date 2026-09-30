import { LandingLiveReading } from "../components/landing-live-reading";
import { DEMO_VIDEO_URL, LANDING } from "../components/landing-content";
import { SiteMenu } from "../components/site-menu";
import { LANDING_SECTIONS } from "../components/site-sections";
import { ThemeToggle } from "../components/theme-toggle";
import { LandingMotion, MOTION_BOOT } from "../components/landing-motion";
import { FactTicker, HeroBackdrop, PageBackdrop, PoolRings } from "../components/landing-visuals";

// The landing page: short claims, a few cards each, and a closing call to
// action: what Basis is, how it decides, and what it found.
// Server-rendered; the client code is the live reading in the hero and
// the decorative motion (components/landing-motion.tsx).
// Words from components/landing-content.ts (basis-project-details.md).
export default function Landing() {
  const { hero, problem, how, guardrails, findings, faq, closing, footer } = LANDING;

  return (
    <div className="landing">
      <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      <LandingMotion />
      <PageBackdrop />
      <header className="topbar">
        <div className="topbar-inner topbar-inner--landing">
          <a className="wordmark" href="/">
            Basis
          </a>
          <div className="topbar-actions">
            <a className="btn btn--primary topbar-cta" href={LANDING.hero.primary.href}>
              {hero.primary.label}
            </a>
            <ThemeToggle />
            <SiteMenu sections={LANDING_SECTIONS} />
          </div>
        </div>
      </header>

      <main>
        <section className="l-hero">
          <HeroBackdrop />
          <div className="l-wrap l-hero-grid">
            <div className="l-hero-copy" data-hero>
              <h1 className="l-h1">{hero.title}</h1>
              <p className="l-lede">{hero.lede}</p>
              <div className="l-ctas">
                <a className="btn btn--primary btn--lg" href={LANDING.hero.primary.href}>
                  {hero.primary.label}
                </a>
                <a className="btn btn--outline btn--lg" href={hero.secondary.href}>
                  {hero.secondary.label}
                </a>
              </div>
              <p className="l-micro">
                {hero.micro}
                {DEMO_VIDEO_URL && (
                  <>
                    {" "}
                    <a href={DEMO_VIDEO_URL}>{hero.videoLabel}</a>
                  </>
                )}
              </p>
            </div>
            <div className="l-hero-card" data-hero>
              <PoolRings />
              <LandingLiveReading />
            </div>
          </div>
          <FactTicker />
        </section>

        <section className="l-section" id="problem">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{problem.title}</h2>
            <div className="l-grid l-grid--3" data-reveal>
              {problem.cards.map((c, i) => (
                <div className="l-tile" key={c.title} style={{ "--i": i } as React.CSSProperties}>
                  <h3 className="l-h3">{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="l-section" id="how">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{how.title}</h2>
            <ol className="l-steps l-steps--3" data-reveal>
              {how.steps.map((s, i) => (
                <li className="l-tile" key={s.title} style={{ "--i": i } as React.CSSProperties}>
                  <span className="l-step mono">0{i + 1}</span>
                  <h3 className="l-h3">{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
            <p className="l-formula mono" data-reveal>
              {how.formula}
            </p>
          </div>
        </section>

        <section className="l-section" id="guardrails">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{guardrails.title}</h2>
            <div className="l-grid l-grid--3" data-reveal>
              {guardrails.cards.map((g, i) => (
                <div className="l-tile" key={g.title} style={{ "--i": i } as React.CSSProperties}>
                  <div className="l-label">{g.title}</div>
                  <div className="l-limit-value">{g.limit}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="l-section" id="findings">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{findings.title}</h2>
            <div className="l-grid l-grid--3" data-reveal>
              {findings.cards.map((f, i) => (
                <div className="l-tile" key={f.label} style={{ "--i": i } as React.CSSProperties}>
                  <div className="l-metric mono">{f.value}</div>
                  <div className="l-label">
                    {f.label} · {f.period}
                  </div>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="l-section" id="faq">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{LANDING.faqTitle}</h2>
            <div className="l-faq l-glass" data-reveal>
              {faq.map((f, i) => (
                <details key={f.q} open={i === 0}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="l-section l-closing">
          <div className="l-wrap" data-reveal>
            <h2 className="l-h2">{closing.title}</h2>
            <a className="btn btn--primary btn--lg" href={closing.cta.href}>
              {closing.cta.label}
            </a>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-wrap l-footer-inner">
          <div className="l-footer-name">{footer.name}</div>
        </div>
      </footer>
    </div>
  );
}
