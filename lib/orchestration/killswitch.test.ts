import { describe, it, expect, beforeEach, vi } from "vitest";

describe("killswitch", () => {
  beforeEach(() => {
    // Every scenario below needs a genuinely fresh module instance —
    // vitest caches modules per file otherwise, which would let a
    // setKillswitchMode() call in one test leak into the next.
    vi.resetModules();
  });

  it("defaults to simulation on a fresh module load, regardless of what a prior instance was set to", async () => {
    const first = await import("./killswitch");
    first.setKillswitchMode("live");
    expect(first.getKillswitchMode()).toBe("live");

    vi.resetModules();
    const second = await import("./killswitch");
    // A brand-new module instance — proves the default is "simulation"
    // baked into module initialization, not merely "we never changed it".
    expect(second.getKillswitchMode()).toBe("simulation");
  });

  it("only changes via its own setter, never implicitly", async () => {
    const killswitch = await import("./killswitch");
    expect(killswitch.getKillswitchMode()).toBe("simulation");

    killswitch.setKillswitchMode("dry-run");
    expect(killswitch.getKillswitchMode()).toBe("dry-run");

    killswitch.setKillswitchMode("live");
    expect(killswitch.getKillswitchMode()).toBe("live");
  });
});
