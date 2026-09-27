"use client";

import dynamic from "next/dynamic";
import { usePoll } from "./use-poll";
import type { CostBreakdown, OpportunitiesResponse, ReferenceQuote, SpreadSeries } from "./api-types";
import { evaluationsTag } from "./counters";
import { AdvisoryFeed } from "./advisory-feed";
import { CHART_HEIGHT } from "./spread-chart";

// The chart library loads after first paint, into a box of fixed height.
const SpreadChart = dynamic(() => import("./spread-chart"), {
  ssr: false,
  loading: () => <div className="chart-box" style={{ height: CHART_HEIGHT }} aria-hidden="true" />,
});

const POLL_MS = 15_000;

function signedPct(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}
const feeLabel = (feeUnits: number) => `${feeUnits / 10_000}%`;
const usd = (v: number, digits = 2) => `$${v.toFixed(digits)}`;

// The Pool Spread Monitor with its side column (cost breakdown and Advisory
// Feed), from one /api/opportunities poll. Every number is the server's:
// pool prices, the Binance quote and the net edge come from the latest
// evaluation; the cost table is that same evaluation split into its costs.
export function PoolSpreadMonitor() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);
  const history = poll.data?.history ?? {};
  const tickers = Object.keys(history);
  const threshold = poll.data?.threshold ?? 0;
  const intervalS = poll.data?.intervalMs ? Math.round(poll.data.intervalMs / 1000) : null;
  const first = tickers[0];
  const series = first ? history[first] : undefined;

  return (
    <div className="spread-grid">
      <section className="panel" id="spread">
        <div className="panel-head">
          <h2 className="panel-title">Pool Spread Monitor{first ? ` · ${first}` : ""}</h2>
          {series && (
            <span className={"pill " + (series.source === "live" ? "pill--live source-tag--live" : "pill--historical source-tag--historical")}>
              {series.source === "live" ? evaluationsTag(series.total ?? series.points.length, series.points.length) : "HISTORICAL FIXTURE · 2026-09-18 → 09-21 · NOT LIVE"}
            </span>
          )}
        </div>

        {poll.loading && !poll.data && <p className="state-message">Loading pool spreads…</p>}
        {poll.error && <p className="state-message state-message--error">Failed to load spreads: {poll.error}</p>}
        {poll.data?.error && <p className="state-message state-message--error">Live pool read unavailable: {poll.data.error}</p>}
        {tickers.length === 0 && !poll.loading && !poll.error && <p className="state-message">No tickers with two or more registered pools.</p>}

        {series ? <TickerBody series={series} threshold={threshold} /> : <div className="chart-box" style={{ height: CHART_HEIGHT + 96 }} aria-hidden="true" />}

        <p className="panel-note">
          {intervalS ? `Every ${intervalS} s` : "On every scheduler tick"}: both pools' spot price and liquidity (PancakeSwap V3 slot0, read over
          the BSC RPC), live gas for both legs (QuoterV2), and a Binance aggregator quote for the same purchase as a cross-check. Basis
          buys the cheaper pool and sells the dearer one; the direction is picked on each reading.
        </p>
      </section>

      <aside className="panel side-panel" aria-label="Cost breakdown and Advisory Feed">
        <section id="costs" aria-labelledby="costs-title">
          <div className="panel-head">
            <h2 className="panel-title" id="costs-title">
              Cost breakdown{series?.costs ? ` · $${series.costs.tradeSizeUsd} order` : ""}
            </h2>
            {series?.costs && <span className="pill pill--plain mono">{series.costs.at.slice(11, 19)} UTC</span>}
          </div>
          {series?.costs && series.points.length > 0 ? (
            <CostTable costs={series.costs} cheapPrice={series.points[series.points.length - 1]!.cheapPoolPriceUsd} dearPrice={series.points[series.points.length - 1]!.expensivePoolPriceUsd} />
          ) : (
            <p className="state-message">The cost table appears with the first live evaluation.</p>
          )}
        </section>

        <AdvisoryFeed observations={poll.data?.observations ?? []} opportunities={poll.data?.opportunities ?? []} loading={poll.loading && !poll.data} />
      </aside>
    </div>
  );
}

function TickerBody({ series, threshold }: { series: SpreadSeries; threshold: number }) {
  const latest = series.points[series.points.length - 1];
  if (!latest) return <p className="state-message">No data yet.</p>;
  const clears = latest.adjustedSpread > Math.max(0, threshold);

  return (
    <>
      <div className="metrics">
        <Metric label={`${feeLabel(latest.cheapPoolFeeUnits)} pool`} value={usd(latest.cheapPoolPriceUsd)} />
        <Metric label={`${feeLabel(latest.expensivePoolFeeUnits)} pool`} value={usd(latest.expensivePoolPriceUsd)} />
        <ReferenceMetric reference={latest.reference} />
        <Metric
          label="Net edge"
          value={signedPct(latest.adjustedSpread)}
          tone={clears ? "pos" : "neg"}
          sub={clears ? "clears threshold" : "no opportunity"}
        />
      </div>
      <p className="reading-line mono">
        {series.source === "live" ? "Latest" : "Last fixture point"}: gross gap {signedPct(latest.rawSpread)} · net edge{" "}
        <strong className={clears ? "reading-clears" : "reading-declines"}>{signedPct(latest.adjustedSpread)}</strong> → {clears ? "clears threshold" : "no opportunity"}
      </p>
      <div className="chart-box" style={{ minHeight: CHART_HEIGHT }}>
        <SpreadChart series={series} />
      </div>
    </>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={"metric-value mono" + (tone ? ` metric-value--${tone}` : "")}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function ReferenceMetric({ reference }: { reference?: ReferenceQuote | null }) {
  if (!reference) return <Metric label="Binance quote" value="—" />;
  if (reference.status === "ok") return <Metric label="Binance quote" value={usd(reference.priceUsd)} sub={reference.vendor} />;
  return <Metric label="Binance quote" value="unavailable" sub={reference.reason} tone="neg" />;
}

const LINE_LABELS: Record<string, (c: CostBreakdown["lines"][number]) => { label: string; sub: string }> = {
  buyFee: (l) => ({ label: `Buy-side fee (${feeLabel(l.feeUnits ?? 0)} pool)`, sub: "paid buying on the cheaper pool" }),
  sellFee: (l) => ({ label: `Sell-side fee (${feeLabel(l.feeUnits ?? 0)} pool)`, sub: "paid selling on the dearer pool" }),
  slippage: () => ({ label: "Slippage", sub: "fixed estimate from the config" }),
  gas: () => ({ label: "Gas, both legs", sub: "live estimate, with a safety margin" }),
};

function CostTable({ costs, cheapPrice, dearPrice }: { costs: CostBreakdown; cheapPrice: number; dearPrice: number }) {
  const cheapFee = costs.lines.find((l) => l.key === "buyFee")?.feeUnits ?? 0;
  const dearFee = costs.lines.find((l) => l.key === "sellFee")?.feeUnits ?? 0;
  return (
    <>
      <table className="cost-table">
        <tbody>
          <tr>
            <th scope="row">
              Gross gap between pools
              <span className="cost-sub">
                {feeLabel(cheapFee)} pool {usd(cheapPrice)} → {feeLabel(dearFee)} pool {usd(dearPrice)}
              </span>
            </th>
            <td className={"mono " + (costs.grossGap >= 0 ? "pos" : "neg")}>{signedPct(costs.grossGap, 3)}</td>
          </tr>
          {costs.lines.map((l) => {
            const { label, sub } = LINE_LABELS[l.key]!(l);
            return (
              <tr key={l.key}>
                <th scope="row">
                  {label}
                  <span className="cost-sub">
                    {sub} · {usd(l.usd, 3)}
                  </span>
                </th>
                <td className="mono neg">{signedPct(l.pct, 3)}</td>
              </tr>
            );
          })}
          <tr className="cost-total">
            <th scope="row">Total costs</th>
            <td className="mono neg">{signedPct(costs.totalCostPct, 3)}</td>
          </tr>
          <tr className="cost-net">
            <th scope="row">Net edge = gross gap + costs</th>
            <td className={"mono " + (costs.netEdge > 0 ? "pos" : "neg")}>{signedPct(costs.netEdge, 3)}</td>
          </tr>
        </tbody>
      </table>
      <p className="panel-note">
        Computed with the Basis Model's own functions for the latest evaluation, so it always equals the monitor's net edge. An order
        is built only when the net edge is above zero.
      </p>
    </>
  );
}
