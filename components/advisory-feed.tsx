import type { Observation, PreviewOpportunity } from "./api-types";

// The Advisory Feed: short lines from fixed text templates filled with
// real numbers — the server's observations (largest gap in the last hour,
// market-status changes; lib/orchestration/observations.ts) and any
// opportunity that clears the threshold (lib/llm/proposal-narrator.ts).
// No AI writes them. Rendered inside the spread monitor's side column,
// from the same /api/opportunities poll.
export function AdvisoryFeed({
  observations,
  opportunities,
  loading,
}: {
  observations: readonly Observation[];
  opportunities: readonly PreviewOpportunity[];
  loading: boolean;
}) {
  return (
    <section className="advisory" aria-labelledby="advisory-title">
      <div className="panel-head panel-head--sub">
        <h2 className="panel-title" id="advisory-title">Advisory Feed</h2>
      </div>
      <p className="panel-sub">generated from fixed templates, not written by the AI</p>

      <div className="advisory-lines">
        {opportunities.map((opportunity, i) => (
          <p className="advisory-line mono" key={`${opportunity.ticker}-${i}`}>
            <span className="advisory-when">[{opportunity.ticker}] net edge {(opportunity.order.adjustedSpread * 100).toFixed(2)}%</span> {opportunity.narration}
          </p>
        ))}
        {observations.map((o) => (
          <p className="advisory-line mono" key={`${o.kind}-${o.at}`}>
            {o.text}
          </p>
        ))}
        {opportunities.length === 0 && (
          <p className="advisory-line advisory-line--quiet mono">{loading ? "connecting…" : "no opportunities currently clear the threshold."}</p>
        )}
      </div>
    </section>
  );
}
