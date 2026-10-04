import type { ReadingResponse } from "../../../components/api-types";
import { HOW } from "../../../components/site-content";
import { pageMetadata } from "../../../components/page-metadata";
import { PageClosing, PageIntro } from "../../../components/site-page-parts";
import { WorkedExample } from "../../../components/worked-example";
import { GET as getReading } from "../../api/reading/route";

export const metadata = pageMetadata("how-it-works");

// Rendered per request: the worked example uses the latest recorded
// reading (a memory read, called in-process), so its numbers are real and
// carry their time. Everything on the page is server-rendered.
export const dynamic = "force-dynamic";

export default async function HowItWorks() {
  const { reading } = (await (await getReading()).json()) as ReadingResponse;
  const nowMs = Date.now();

  return (
    <>
      <PageIntro title={HOW.title} lede={HOW.lede} />

      <section className="l-section l-section--tight" id="steps">
        <div className="l-wrap">
          <ol className="l-stack" data-reveal>
            {HOW.steps.map((s, i) => (
              <li className="l-tile l-detail" key={s.name} style={{ "--i": i } as React.CSSProperties}>
                <span className="l-step mono">0{i + 1}</span> <span className="l-label">{s.name}</span>
                <h2 className="l-h3 l-h3--lg">{s.title}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p.slice(0, 24)}>{p}</p>
                ))}
              </li>
            ))}
          </ol>
          <p className="l-formula mono" data-reveal>
            {HOW.formula}
          </p>
        </div>
      </section>

      <section className="l-section l-section--tight" id="example">
        <div className="l-wrap">
          <h2 className="l-h2" data-reveal>{HOW.example.title}</h2>
          <p className="l-sub">{HOW.example.intro}</p>
          <WorkedExample reading={reading} nowMs={nowMs} />
        </div>
      </section>

      <section className="l-section" id="apis">
        <div className="l-wrap">
          <h2 className="l-h2" data-reveal>{HOW.apisTitle}</h2>
          <div className="l-grid l-grid--2" data-reveal>
            {HOW.apis.map((a, i) => (
              <div className="l-tile" key={a.title} style={{ "--i": i } as React.CSSProperties}>
                <h3 className="l-h3">{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
          </div>
          <p className="l-sub">{HOW.apisNote}</p>
        </div>
      </section>

      <PageClosing />
    </>
  );
}
