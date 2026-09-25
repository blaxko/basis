import { describe, it, expect, vi } from "vitest";
import { AuditLedger } from "./audit-ledger";

const detection = {
  ticker: "MSFT",
  cheapPool: { address: "0x5018b018ceb7645c927c5cf246786f89ebcbe7ea", feeUnits: 2500, priceUsd: 496.3821 },
  expensivePool: { address: "0x58e44c2e5b17ef40915b4b3ae8451b6b87285b44", feeUnits: 10000, priceUsd: 496.9976 },
  grossGap: 0.00124,
  netEdge: -0.0128,
  threshold: 0.0001,
  gas: { costUsd: 0.21, source: "fallback" as const },
  reference: { status: "ok" as const, priceUsd: 498.8459, vendor: "LiquidMesh", route: "Rfq Neptunex" },
};

describe("AuditLedger — detection entries are a different kind from pipeline entries", () => {
  it("appendNoOpportunity writes kind=detection, outcome=no_opportunity, and no verdict", () => {
    const ledger = new AuditLedger();
    const entry = ledger.appendNoOpportunity({ mode: "simulation", detection });

    expect(entry.kind).toBe("detection");
    expect(entry.outcome).toBe("no_opportunity");
    expect(entry.detection).toEqual(detection);
    expect("verdict" in entry).toBe(false);
    expect(ledger.readAll()).toEqual([entry]);
  });

  it("appendWarmingUp writes kind=detection, outcome=warming_up, with the reading counts and no verdict", () => {
    const ledger = new AuditLedger();
    const entry = ledger.appendWarmingUp({ mode: "simulation", detection, warmUp: { readings: 3, required: 10 } });

    expect(entry.kind).toBe("detection");
    expect(entry.outcome).toBe("warming_up");
    expect(entry.warmUp).toEqual({ readings: 3, required: 10 });
    expect("verdict" in entry).toBe(false);
  });

  it("gives every entry a unique id, across both kinds", () => {
    const ledger = new AuditLedger();
    const ids = [
      ledger.appendNoOpportunity({ mode: "simulation", detection }).id,
      ledger.appendNoOpportunity({ mode: "simulation", detection }).id,
      ledger.appendNoOpportunity({ mode: "simulation", detection }).id,
    ];
    expect(new Set(ids).size).toBe(3);
  });
});

describe("defaultLedger — one per process, not one per bundle", () => {
  it("a second module instance in the same process sees the same entries", async () => {
    vi.resetModules();
    const routeBundle = await import("./audit-ledger");
    vi.resetModules();
    const schedulerBundle = await import("./audit-ledger");
    expect(schedulerBundle).not.toBe(routeBundle);

    const entry = schedulerBundle.defaultLedger.appendNoOpportunity({ mode: "simulation", detection });
    expect(routeBundle.defaultLedger.readAll()).toContain(entry);
  });
});
