import { FAQ_PAGE } from "../../../components/site-content";
import { pageMetadata } from "../../../components/page-metadata";
import { PageClosing, PageIntro } from "../../../components/site-page-parts";

export const metadata = pageMetadata("faq");

// Static. Every answer is a native <details>: no JavaScript.
export default function Faq() {
  return (
    <>
      <PageIntro title={FAQ_PAGE.title} lede={FAQ_PAGE.lede} />

      <section className="l-section l-section--tight" id="questions">
        <div className="l-wrap">
          {FAQ_PAGE.groups.map((g, gi) => (
            <div className="l-faq-group" key={g.title} data-reveal>
              <h2 className="l-h3 l-h3--lg">{g.title}</h2>
              <div className="l-faq l-glass">
                {g.items.map((f, i) => (
                  <details key={f.q} open={gi === 0 && i === 0}>
                    <summary>{f.q}</summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <PageClosing />
    </>
  );
}
