import { LANDING } from "./landing-content";

// Small server-rendered parts the four pages (and the landing page) share.
// No client code: nothing here ships JavaScript.

// The top of a page: its claim and one sentence.
export function PageIntro({ title, lede }: { title: string; lede: string }) {
  return (
    <section className="l-pagehead">
      <div className="l-wrap" data-hero>
        <h1 className="l-h1 l-h1--page">{title}</h1>
        <p className="l-lede">{lede}</p>
      </div>
    </section>
  );
}

// The small "Read more" link at the end of a landing-page section. Its
// name says what it opens; the visible words are "Read more".
export function ReadMore({ href, label }: { href: string; label: string }) {
  return (
    <a className="l-readmore" href={href} aria-label={`Read more: ${label}`}>
      Read more <span aria-hidden="true">→</span>
    </a>
  );
}

// The end of a page: the dashboard, and the way back to the overview.
export function PageClosing() {
  return (
    <section className="l-section l-closing">
      <div className="l-wrap" data-reveal>
        <h2 className="l-h2">{LANDING.closing.title}</h2>
        <a className="btn btn--primary btn--lg" href={LANDING.closing.cta.href}>
          {LANDING.closing.cta.label}
        </a>
        <p>
          <a className="l-readmore" href="/">
            <span aria-hidden="true">←</span> Back to the overview
          </a>
        </p>
      </div>
    </section>
  );
}
