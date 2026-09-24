import { describe, it, expect, beforeEach, vi } from "vitest";

const STATE_KEY = Symbol.for("basis.killswitch.state");

// Simulates a brand-new server process: the mode lives on globalThis, so
// a fresh process is one where that key has never been set.
function freshProcess() {
  delete (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY];
  vi.resetModules();
}

describe("killswitch", () => {
  beforeEach(() => {
    freshProcess();
  });

  it("defaults to simulation in a fresh process, regardless of what a previous process was set to", async () => {
    const first = await import("./killswitch");
    first.setKillswitchMode("live");
    expect(first.getKillswitchMode()).toBe("live");

    freshProcess();
    const second = await import("./killswitch");
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

  it("a second module instance in the same process sees the same mode (scheduler and API routes are separate bundles)", async () => {
    const routeBundle = await import("./killswitch");
    vi.resetModules();
    const schedulerBundle = await import("./killswitch");
    expect(schedulerBundle).not.toBe(routeBundle);

    routeBundle.setKillswitchMode("dry-run");
    expect(schedulerBundle.getKillswitchMode()).toBe("dry-run");
  });
});
