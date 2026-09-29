import { LandingLiveReading } from "../components/landing-live-reading";
import { DEMO_VIDEO_URL, GITHUB_URL, LANDING } from "../components/landing-content";

// The landing page: what Basis is, how it decides, and what it found.
// Server-rendered; the only client code is the live reading in the hero.
// Words from components/landing-content.ts (basis-project-details.md).
export default function Landing() {
  const { hero, problem, how, findings, issuers, limits, faq, footer } = LANDING;

  return (
    <div className="landing">
      <header className="topbar">
        <div className="topbar-inner topbar-inner--landing">
          <a className="wordmark" href="/">
            Basis
          </a>
          <nav className="topnav topnav--wide" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#guardrails">Guardrails</a>
            <a href="#findings">Findings</a>
            <a href="#faq">FAQ</a>
            <a href={GITHUB_URL}>GitHub</a>
          </nav>
          <a className="btn btn--primary topbar-cta" href={LANDING.hero.primary.href}>
            {hero.primary.label}
          </a>
        </div>
      </header>

      <main>
        <section className="l-hero">
          <div className="l-wrap l-hero-grid">
            <div>
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
            <LandingLiveReading />
          </div>
        </section>

        <section className="l-section" id="problem">
          <div className="l-wrap">
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
            <h2 className="l-h2">{how.title}</h2>
            <ol className="l-steps">
              {how.steps.map((s, i) => (
                <li className="l-tile" key={s.title}>
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
            <h2 className="l-h2">{LANDING.guardrailsTitle}</h2>
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
            <p className="l-sub">{LANDING.guardrailsNote}</p>
          </div>
        </section>

        <section className="l-section" id="findings">
          <div className="l-wrap">
            <h2 className="l-h2">{findings.title}</h2>
            <div className="l-grid l-grid--2">
              {findings.items.map((f) => (
                <div className="l-tile" key={f.title}>
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
            <div className="l-grid l-grid--3">
              {issuers.facts.map((f) => (
                <div className="l-tile" key={f.label}>
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
            <h2 className="l-h2">{limits.title}</h2>
            <ul className="l-list">
              {limits.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="l-sub">{limits.next}</p>
          </div>
        </section>

        <section className="l-section" id="faq">
          <div className="l-wrap">
            <h2 className="l-h2">Questions</h2>
            <div className="l-faq">
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
          <div>
            <div className="l-footer-name">{footer.name}</div>
            <div>{footer.risk}</div>
          </div>
          <nav className="l-footer-links" aria-label="Links">
            <a href={LANDING.hero.primary.href}>Dashboard</a>
            <a href={GITHUB_URL}>GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
