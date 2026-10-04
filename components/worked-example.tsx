import type { LiveReading } from "./api-types";
import { STALE_AFTER_S, readingVerdict } from "./live-reading-view";

// The How it works page's worked example: the latest recorded reading,
// laid out as the formula (gap, then each cost, then the net edge) so a
// visitor can see exactly why the edge is what it is. Every number is the
// reading's own (/api/reading, the dashboard's cost table); nothing here
// is computed from anything else. No reading, or one too old to call live:
// "unavailable", with no numbers.

export type WorkedExampleView =
  | { kind: "unavailable" }
  | {
      kind: "ok";
      at: string;
      ageS: number;
      tradeSizeUsd: number;
      buy: { fee: string; priceUsd: number };
      sell: { fee: string; priceUsd: number };
      rows: Array<{ label: string; pct: number; usd?: number }>;
      netEdge: number;
      verdict: string;
    };

const feeLabel = (feeUnits: number) => `${feeUnits / 10_000}%`;

export function workedExample(reading: LiveReading | null, nowMs: number): WorkedExampleView {
  if (!reading) return { kind: "unavailable" };
  const ageS = Math.max(0, Math.round((nowMs - Date.parse(reading.at)) / 1000));
  if (!Number.isFinite(ageS) || ageS > STALE_AFTER_S) return { kind: "unavailable" };

  const line = (key: LiveReading["lines"][number]["key"]) => reading.lines.find((l) => l.key === key);
  const buyFee = line("buyFee");
  const sellFee = line("sellFee");
  const slippage = line("slippage");
  const gas = line("gas");
  if (buyFee?.feeUnits === undefined || sellFee?.feeUnits === undefined || !slippage || !gas) return { kind: "unavailable" };
  const pool = (fee: string) => reading.pools.find((p) => p.fee === fee);
  const buy = pool(feeLabel(buyFee.feeUnits));
  const sell = pool(feeLabel(sellFee.feeUnits));
  if (!buy || !sell) return { kind: "unavailable" };

  return {
    kind: "ok",
    at: reading.at,
    ageS,
    tradeSizeUsd: reading.tradeSizeUsd,
    buy: { fee: buy.fee, priceUsd: buy.priceUsd },
    sell: { fee: sell.fee, priceUsd: sell.priceUsd },
    rows: [
      { label: "Gap between the pools", pct: reading.grossGap },
      { label: `Buy-side fee (${buy.fee} pool)`, pct: buyFee.pct, usd: buyFee.usd },
      { label: `Sell-side fee (${sell.fee} pool)`, pct: sellFee.pct, usd: sellFee.usd },
      { label: "Slippage (fixed estimate)", pct: slippage.pct, usd: slippage.usd },
      { label: "Gas for both swaps", pct: gas.pct, usd: gas.usd },
    ],
    netEdge: reading.netEdge,
    verdict: readingVerdict(reading.netEdge),
  };
}

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(3)}%`;
// A cost, as the amount taken off (its label starts with a minus sign).
const magnitude = (v: number) => `${Math.abs(v * 100).toFixed(3)}%`;
const usd = (v: number) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`;

export function WorkedExample({ reading, nowMs }: { reading: LiveReading | null; nowMs: number }) {
  const w = workedExample(reading, nowMs);
  if (w.kind !== "ok") {
    return (
      <div className="l-worked l-glass">
        <p>Live reading unavailable.</p>
        <p>
          <a href="/app">Open the dashboard</a>
        </p>
      </div>
    );
  }
  return (
    <div className="l-worked l-glass">
      <p className="l-worked-head">
        Recorded at {w.at.slice(11, 19)} UTC, {w.ageS} s before this page loaded.
      </p>
      <p className="l-worked-buy">
        A ${w.tradeSizeUsd} trade: buy in the {w.buy.fee} pool at <span className="mono">${w.buy.priceUsd.toFixed(2)}</span>, sell in the {w.sell.fee} pool at{" "}
        <span className="mono">${w.sell.priceUsd.toFixed(2)}</span>.
      </p>
      <dl className="live-rows">
        {w.rows.map((r, i) => (
          <div className="live-row" key={r.label}>
            <dt>{i === 0 ? r.label : `− ${r.label}`}</dt>
            <dd className={"mono" + (i === 0 ? "" : " neg")}>
              {i === 0 ? pct(r.pct) : magnitude(r.pct)}
              {r.usd !== undefined && <span className="l-worked-usd"> ({usd(r.usd)})</span>}
            </dd>
          </div>
        ))}
        <div className="live-row live-row--net">
          <dt>= Net edge</dt>
          <dd className={"mono " + (w.netEdge > 0 ? "pos" : "neg")}>{pct(w.netEdge)}</dd>
        </div>
      </dl>
      <p className="live-foot">{w.verdict}</p>
    </div>
  );
}
