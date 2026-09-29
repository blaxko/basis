"use client";

import dynamic from "next/dynamic";
import { usePoll } from "./use-poll";
import type { CostBreakdown, OpportunitiesResponse, SpreadSeries } from "./api-types";
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

// The live reading: the two pools, the gross gap and the net edge after
// every cost, with the chart. Secondary detail (the cost breakdown, the
// Advisory Feed, how the reading is made) sits behind toggles. Every number
// is the server's, from one /api/opportunities poll: the cost table is the
// latest evaluation split into its costs.
export function PoolSpreadMonitor() {
  const poll = usePoll<OpportunitiesResponse>("/api/opportunities", POLL_MS);
  const history = poll.data?.history ?? {};
  const tickers = Object.keys(history);
  const threshold = poll.data?.threshold ?? 0;
  const intervalS = poll.data?.intervalMs ? Math.round(poll.data.intervalMs / 1000) : null;
  const first = tickers[0];
  const series = first ? history[first] : undefined;
  const latest = series?.points[series.points.length - 1];

  return (
    <section className="panel panel--main" id="spread">
      <div className="panel-head">
        <h2 className="panel-title">{first === "MSFT" || !first ? "MSFTB / USDT" : first} · PancakeSwap V3</h2>
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

      {series ? (
        <TickerBody series={series} threshold={threshold} />
      ) : (
        // Same shape as the loaded reading (no layout shift), with no numbers.
        <>
          <div className="metrics" aria-hidden="true">
            {["Pool", "Pool", "Gross gap"].map((label, i) => (
              <Metric key={i} label={label} value="—" />
            ))}
            <Metric label="Net edge after costs" value="—" sub={" "} main />
          </div>
          <div className="chart-box" style={{ height: CHART_HEIGHT }} aria-hidden="true" />
        </>
      )}

      <div className="toggles">
        <details id="costs">
          <summary>
            Cost breakdown{series?.costs ? ` · $${series.costs.tradeSizeUsd} order · ${signedPct(series.costs.totalCostPct, 3)} in total` : ""}
          </summary>
          {series?.costs && latest ? (
            <CostTable costs={series.costs} cheapPrice={latest.cheapPoolPriceUsd} dearPrice={latest.expensivePoolPriceUsd} />
          ) : (
            <p className="state-message">The cost table appears with the first live evaluation.</p>
          )}
        </details>

        <AdvisoryFeed observations={poll.data?.observations ?? []} opportunities={poll.data?.opportunities ?? []} loading={poll.loading && !poll.data} />

        <details>
          <summary>How this is read</summary>
          <p className="panel-note">
            {intervalS ? `Every ${intervalS} s` : "On every scheduler tick"}: both pools' spot price and liquidity (PancakeSwap V3 slot0, read over
            the BSC RPC), live gas for both legs (QuoterV2), and a Binance aggregator quote for the same purchase as a cross-check
            {latest?.reference?.status === "ok" ? ` (latest ${usd(latest.reference.priceUsd)}, ${latest.reference.vendor})` : latest?.reference ? " (latest: unavailable)" : ""}.
            Basis buys the cheaper pool and sells the dearer one; the direction is picked on each reading.
          </p>
        </details>
      </div>
    </section>
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
        <Metric label="Gross gap" value={signedPct(latest.rawSpread, 3)} />
        <Metric
          label="Net edge after costs"
          value={signedPct(latest.adjustedSpread, 3)}
          tone={clears ? "pos" : "neg"}
          sub={clears ? "clears threshold" : "no opportunity"}
          main
        />
      </div>
      <div className="chart-box" style={{ minHeight: CHART_HEIGHT }}>
        <SpreadChart series={series} />
      </div>
    </>
  );
}

function Metric({ label, value, sub, tone, main }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; main?: boolean }) {
  return (
    <div className={"metric" + (main ? " metric--main" : "")}>
      <div className="metric-label">{label}</div>
      <div className={"metric-value mono" + (tone ? ` metric-value--${tone}` : "")}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
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
