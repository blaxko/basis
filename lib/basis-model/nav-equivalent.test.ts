import { describe, it, expect } from "vitest";
import { navEquivalent } from "./nav-equivalent";

describe("navEquivalent", () => {
  it("subtracts accrued dividend from the Ondo price", () => {
    expect(navEquivalent(420.83, 0.83)).toBeCloseTo(420.0, 5);
  });

  it("returns the raw price unchanged when nothing has accrued", () => {
    expect(navEquivalent(420.0, 0)).toBe(420.0);
  });
});
