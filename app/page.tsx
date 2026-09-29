import { LandingLiveReading } from "../components/landing-live-reading";
import { DEMO_VIDEO_URL, LANDING } from "../components/landing-content";
import { SiteMenu } from "../components/site-menu";
import { LANDING_SECTIONS } from "../components/site-sections";
import { ThemeToggle } from "../components/theme-toggle";
import { LandingMotion, MOTION_BOOT } from "../components/landing-motion";
import { FactTicker, HeroBackdrop, PageBackdrop, PoolRings } from "../components/landing-visuals";

// The landing page: what Basis is, how it decides, and what it found.
// Server-rendered; the client code is the live reading in the hero and
// the decorative motion (components/landing-motion.tsx).
// Words from components/landing-content.ts (basis-project-details.md).
export default function Landing() {
  const { hero, problem, how, findings, issuers, limits, faq, footer } = LANDING;

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
                {hero.micro}{" "}
                {DEMO_VIDEO_URL ? (
                  <a href={DEMO_VIDEO_URL}>{hero.videoLabel}</a>
                ) : (
                  <span>{hero.videoPending}.</span>
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
          <div className="l-wrap" data-reveal>
            <h2 className="l-h2">{problem.title}</h2>
            {problem.body.map((p) => (
              <p className="l-sub" key={p.slice(0, 24)}>
                {p}
              </p>
            ))}
          </div>
        </section>

        <section className="l-section" id="how">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{how.title}</h2>
            <ol className="l-steps" data-reveal>
              {how.steps.map((s, i) => (
                <li className="l-tile" key={s.title} style={{ "--i": i } as React.CSSProperties}>
                  <span className="l-step mono">0{i + 1}</span>
                  <h3 className="l-h3">{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
            <p className="l-sub">{how.instructions}</p>
          </div>
        </section>

        <section className="l-section" id="guardrails">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{LANDING.guardrailsTitle}</h2>
            <div className="l-glass l-glass--table" data-reveal>
            <table className="l-table">
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Limit</th>
                </tr>
              </thead>
              <tbody>
                {LANDING.guardrails.map((g) => (
                  <tr key={g.check}>
                    <th scope="row">{g.check}</th>
                    <td>{g.does}</td>
                    <td className="l-limit mono" data-label="Limit">
                      {g.limit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="l-sub">{LANDING.guardrailsNote}</p>
          </div>
        </section>

        <section className="l-section" id="findings">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{findings.title}</h2>
            <div className="l-grid l-grid--2" data-reveal>
              {findings.items.map((f, i) => (
                <div className="l-tile" key={f.title} style={{ "--i": i } as React.CSSProperties}>
                  <span className="l-tag">{f.tag}</span>
                  <h3 className="l-h3">{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>

            <h2 className="l-h2 l-h2--minor" id="issuers">
              {issuers.title}
            </h2>
            <p className="l-sub">{issuers.body}</p>
            <p className="monitor-only">{issuers.label}</p>
            <div className="l-grid l-grid--3" data-reveal>
              {issuers.facts.map((f, i) => (
                <div className="l-tile" key={f.label} style={{ "--i": i } as React.CSSProperties}>
                  <div className="l-label">{f.label}</div>
                  <div className="l-metric mono">{f.value}</div>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="l-section" id="limits">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>{limits.title}</h2>
            <ul className="l-list" data-reveal>
              {limits.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="l-sub">{limits.next}</p>
          </div>
        </section>

        <section className="l-section" id="faq">
          <div className="l-wrap">
            <h2 className="l-h2" data-reveal>Questions</h2>
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
      </main>

      <footer className="l-footer">
        <div className="l-wrap l-footer-inner">
          <div className="l-footer-name">{footer.name}</div>
        </div>
      </footer>
    </div>
  );
}
