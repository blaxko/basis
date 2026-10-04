import { GUARDRAILS } from "../../../components/site-content";
import { pageMetadata } from "../../../components/page-metadata";
import { PageClosing, PageIntro } from "../../../components/site-page-parts";

export const metadata = pageMetadata("guardrails");

// Static: nothing here changes between requests.
export default function Guardrails() {
  const { checks, more, failing } = GUARDRAILS;

  return (
    <>
      <PageIntro title={GUARDRAILS.title} lede={GUARDRAILS.lede} />

      <section className="l-section l-section--tight" id="checks">
        <div className="l-wrap">
          <div className="l-grid l-grid--2" data-reveal>
            {checks.map((c, i) => (
              <article className="l-tile l-detail" key={c.name} style={{ "--i": i } as React.CSSProperties}>
                <span className="l-step mono">0{i + 1}</span> <span className="l-label">{c.name}</span>
                <h2 className="l-h3 l-h3--lg">{c.title}</h2>
                <dl className="l-facts">
                  <div>
                    <dt>Measures</dt>
                    <dd>{c.measures}</dd>
                  </div>
                  <div>
                    <dt>Limit</dt>
                    <dd>{c.limit}</dd>
                  </div>
                  <div>
                    <dt>If it fails</dt>
                    <dd>{c.fails}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section l-section--tight" id="more">
        <div className="l-wrap">
          <h2 className="l-h2" data-reveal>{more.title}</h2>
          <div className="l-grid l-grid--2" data-reveal>
            {more.items.map((m, i) => (
              <div className="l-tile" key={m.title} style={{ "--i": i } as React.CSSProperties}>
                <h3 className="l-h3">{m.title}</h3>
                <p>{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section l-section--tight" id="failing">
        <div className="l-wrap l-prose" data-reveal>
          <h2 className="l-h2">{failing.title}</h2>
          {failing.paragraphs.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </section>

      <PageClosing />
    </>
  );
}
