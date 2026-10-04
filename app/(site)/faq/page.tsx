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
          <div className="l-faq l-glass" data-reveal>
            {FAQ_PAGE.items.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <PageClosing />
    </>
  );
}
