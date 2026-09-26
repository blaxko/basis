import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatBalance, walletChipLabel } from "../components/format-balance";

// Live site, 2026-09-26: the wallet chip read
// "WALLET · 0.00290496885 BNB · 4.975031264553765393 USDT · 0 MSFTB" (every
// on-chain decimal, then uppercased; the address chip read "0X0BA5…BB95").

const ROOT = join(__dirname, "..");

describe("balances are shown readably", () => {
  it.each([
    ["0.00290496885", 4, "0.0029"],
    ["4.975031264553765393", 3, "4.975"],
    ["0", 6, "0"],
    ["5", 3, "5"],
    ["0.009987029532613962", 6, "0.009987"],
    ["12.5000", 3, "12.5"],
    ["0.00000001", 4, "<0.0001"],
  ])("%s at %i dp → %s", (raw, dp, shown) => {
    expect(formatBalance(raw, dp)).toBe(shown);
  });

  it("the wallet chip, from the live balances", () => {
    expect(walletChipLabel({ bnb: "0.00290496885", usdt: "4.975031264553765393", msftb: "0" })).toBe("Wallet · 0.0029 BNB · 4.975 USDT · 0 MSFTB");
  });

  it("the header uses it", () => {
    expect(readFileSync(join(ROOT, "components/header.tsx"), "utf8")).toContain("walletChipLabel(");
  });

  it("chips aren't uppercased (hex addresses and 'ms' would read wrong)", () => {
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    const chipRule = css.slice(css.indexOf(".status-chip {"), css.indexOf("}", css.indexOf(".status-chip {")));
    expect(chipRule).not.toContain("text-transform: uppercase");
  });
});
