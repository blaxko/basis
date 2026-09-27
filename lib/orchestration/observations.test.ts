import { describe, it, expect, beforeEach } from "vitest";
import { observations } from "./observations";
import { recordLatestMarketStatus, getMarketStatusChanges, resetMarketStatusHistory } from "../data/binance-rwa";
import type { EvaluationPoint, DetectionSnapshot } from "../execution/audit-ledger";

// The Advisory Feed was always empty ("no opportunities currently clear the
// threshold"). It now posts observations from fixed templates, computed
// from real readings only. No AI writes them.

const T0 = Date.parse("2026-09-26T18:00:00Z");

function point(minutesAgo: number, gross: number, net: number): EvaluationPoint {
  return {
    timestamp: T0 - minutesAgo * 60_000,
    detection: {
      ticker: "MSFT",
      cheapPool: { address: "0xa", feeUnits: 2500, priceUsd: 518.75 },
      expensivePool: { address: "0xb", feeUnits: 10000, priceUsd: 519.16 },
      grossGap: gross,
      netEdge: net,
      threshold: 0.0001,
      gas: { costUsd: 0.024, source: "live" },
      reference: { status: "ok", priceUsd: 519.1, vendor: "LiquidMesh", route: "x" },
      marketStatus: { status: "ok", openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: "t" },
    } as DetectionSnapshot,
  };
}

const ok = (code: string, at: string) => ({ status: "ok" as const, openState: true, reasonCode: code, marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null, fetchedAt: at });

beforeEach(() => resetMarketStatusHistory());

describe("observations (fixed templates, real data)", () => {
  it("the largest gross gap and best net edge in the last hour, with the time", () => {
    const pts = [point(90, 0.009, -0.004), point(50, 0.0012, -0.0118), point(20, 0.0008, -0.0123), point(1, 0.0005, -0.0126)];
    const obs = observations("MSFT", pts, [], T0);
    expect(obs[0]).toEqual({
      kind: "largest_gap",
      at: new Date(T0 - 50 * 60_000).toISOString(),
      text: "Largest gross gap between the pools in the last hour: +0.120% at 17:10:00 UTC (net edge -1.180%). Best net edge in the hour: -1.180%. Both below zero after costs.",
    }); // the 90-minute-old reading is outside the hour
  });

  it("market status: unchanged since first seen, or each change with its time", () => {
    recordLatestMarketStatus("MSFT", ok("TRADING", "2026-09-26T17:00:00.000Z"));
    recordLatestMarketStatus("MSFT", ok("TRADING", "2026-09-26T17:30:00.000Z"));
    expect(observations("MSFT", [], getMarketStatusChanges("MSFT"), T0)).toEqual([
      { kind: "market_status", at: "2026-09-26T17:00:00.000Z", text: "MSFT underlying market (Binance RWA status): TRADING, unchanged since 17:00 UTC." },
    ]);
    recordLatestMarketStatus("MSFT", ok("MARKET_CLOSED", "2026-09-26T17:45:00.000Z"));
    const obs = observations("MSFT", [], getMarketStatusChanges("MSFT"), T0);
    expect(obs).toContainEqual({ kind: "market_status", at: "2026-09-26T17:45:00.000Z", text: "MSFT underlying market (Binance RWA status): TRADING → MARKET_CLOSED at 17:45 UTC." });
  });

  it("an unavailable status is a change too, and the history is bounded", () => {
    recordLatestMarketStatus("MSFT", ok("TRADING", "2026-09-26T17:00:00.000Z"));
    recordLatestMarketStatus("MSFT", { status: "unavailable", reason: "Binance: timed out", fetchedAt: "2026-09-26T17:01:00.000Z" });
    expect(getMarketStatusChanges("MSFT").map((c) => c.to)).toEqual(["TRADING", "unavailable"]);
    for (let i = 0; i < 200; i++) recordLatestMarketStatus("MSFT", ok(i % 2 ? "TRADING" : "MARKET_CLOSED", new Date(T0 + i * 1000).toISOString()));
    expect(getMarketStatusChanges("MSFT").length).toBeLessThanOrEqual(50);
  });

  it("with no readings, says nothing rather than inventing", () => {
    expect(observations("MSFT", [], [], T0)).toEqual([]);
  });
});
