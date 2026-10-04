import { LandingLiveReading } from "../../components/landing-live-reading";
import { DEMO_VIDEO_URL, LANDING } from "../../components/landing-content";
import type { ReadingResponse } from "../../components/api-types";
import { HeroBackdrop, PoolRings } from "../../components/landing-visuals";
import { GET as getReading } from "../api/reading/route";

// Rendered per request, so the live reading arrives in the HTML with the
// latest real values (never an empty loading state); the browser then
// refreshes it. The reading is a memory read (app/api/reading/route.ts,
// called in-process here), so this costs nothing measurable.
export const dynamic = "force-dynamic";

// The landing page, the overview: what Basis is, why a gap isn't a profit,
// how it decides, what a visitor can try, and what it found. Short claims
// as headings and one full sentence per card. It has no links to the four
// pages (How it works, Guardrails, Findings, FAQ): those open only from the
// menu. The header, footer and glass backdrop come from the shared layout
// (app/(site)/layout.tsx). Server-rendered; the client code here is the
// live reading's refresh.
// Words from components/landing-content.ts.
export default async function Landing() {
  const { hero, tokenized, problem, how, tryIt, guardrails, findings, builtWith, faq, closing } = LANDING;
  const { reading } = (await (await getReading()).json()) as ReadingResponse;
  const renderedAt = Date.now();

  return (
    <>
      <section className="l-hero">
        <HeroBackdrop />
        <div className="l-wrap l-hero-grid">
          <div className="l-hero-copy" data-hero>
            <p className="l-eyebrow">{hero.eyebrow}</p>
            <h1 className="l-h1">{hero.title}</h1>
            {hero.lede.map((s) => (
              <p className="l-lede" key={s.slice(0, 16)}>
                {s}
              </p>
            ))}
            <div className="l-ctas">
              <a className="btn btn--primary btn--lg" href={hero.primary.href}>
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
            <LandingLiveReading initial={reading} renderedAt={renderedAt} />
          </div>
        </div>
      </section>

      <section className="l-section l-section--tight" id="tokenized">
        <div className="l-wrap" data-reveal>
          <h2 className="l-h2">{tokenized.title}</h2>
          <p className="l-sub">{tokenized.body}</p>
        </div>
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

      <section className="l-section" id="try">
        <div className="l-wrap">
          <h2 className="l-h2" data-reveal>{tryIt.title}</h2>
          <div className="l-grid l-grid--4" data-reveal>
            {tryIt.cards.map((c, i) => (
              <a className="l-tile l-tile--link" key={c.title} href={c.href} style={{ "--i": i } as React.CSSProperties}>
                <h3 className="l-h3">
                  {c.title} <span aria-hidden="true">→</span>
                </h3>
                <p>{c.body}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section" id="guardrails">
        <div className="l-wrap">
          <h2 className="l-h2" data-reveal>{guardrails.title}</h2>
          <div className="l-grid l-grid--3" data-reveal>
            {guardrails.cards.map((g, i) => (
              <div className="l-tile" key={g.title} style={{ "--i": i } as React.CSSProperties}>
                <h3 className="l-h3">{g.title}</h3>
                <p>{g.body}</p>
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
              <div className="l-tile" key={f.title} style={{ "--i": i } as React.CSSProperties}>
                <div className="l-label">{f.period}</div>
                <h3 className="l-h3">{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section l-section--tight" id="built-with">
        <div className="l-wrap" data-reveal>
          <h2 className="l-h2 l-h2--minor">{builtWith.title}</h2>
          <ul className="l-built">
            {builtWith.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
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
    </>
  );
}
