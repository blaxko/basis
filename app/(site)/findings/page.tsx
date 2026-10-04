import { FINDINGS } from "../../../components/site-content";
import { pageMetadata } from "../../../components/page-metadata";
import { PageClosing, PageIntro } from "../../../components/site-page-parts";

export const metadata = pageMetadata("findings");

// Static: the figures are recounted and the page rebuilt at each deploy
// (components/finding-facts.ts).
export default function Findings() {
  return (
    <>
      <PageIntro title={FINDINGS.title} lede={FINDINGS.lede} />

      <section className="l-section l-section--tight" id="all">
        <div className="l-wrap">
          <div className="l-stack">
            {FINDINGS.findings.map((f, i) => (
              <article className="l-tile l-detail" key={f.title} data-reveal style={{ "--i": i } as React.CSSProperties}>
                <div className="l-label">{f.period}</div>
                <h2 className="l-h3 l-h3--lg">{f.title}</h2>
                <dl className="l-facts">
                  <div>
                    <dt>How it was measured</dt>
                    <dd>{f.measured}</dd>
                  </div>
                  <div>
                    <dt>What it showed</dt>
                    <dd>{f.showed}</dd>
                  </div>
                  <div>
                    <dt>Why it was rejected</dt>
                    <dd>{f.why}</dd>
                  </div>
                </dl>
                {f.notes.length > 0 && (
                  <ul className="l-notes">
                    {f.notes.map((n) => (
                      <li key={n.slice(0, 24)}>{n}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <PageClosing />
    </>
  );
}
