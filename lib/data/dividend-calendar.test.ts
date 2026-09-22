import { describe, it, expect } from "vitest";
import { accruedDividend } from "./dividend-calendar";

describe("accruedDividend", () => {
  it("is zero before any recorded ex-dividend date", () => {
    expect(accruedDividend("MSFT", "2025-01-01")).toBe(0);
  });

  it("includes a dividend on its ex-dividend date", () => {
    expect(accruedDividend("MSFT", "2025-08-21")).toBeCloseTo(0.83, 5);
  });

  it("is zero for an underlying with no dividend history (TSLA)", () => {
    expect(accruedDividend("TSLA", "2026-01-01")).toBe(0);
  });
});
