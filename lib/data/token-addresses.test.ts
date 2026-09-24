import { describe, it, expect } from "vitest";
import { getTokenAddresses } from "./token-addresses";

describe("getTokenAddresses — empty registry, no fabricated addresses", () => {
  it("throws NotImplemented for any ticker, since no real addresses are confirmed yet", () => {
    expect(() => getTokenAddresses("MSFT")).toThrow(/NotImplemented/);
    expect(() => getTokenAddresses("NVDA")).toThrow(/NotImplemented/);
  });
});
