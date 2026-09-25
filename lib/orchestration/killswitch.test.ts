import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

describe("killswitch — public demo returns to simulation 5 minutes after a change", () => {
  const T0 = Date.parse("2026-09-25T21:10:00.000Z");
  const MIN = 60_000;

  beforeEach(() => {
    freshProcess();
    vi.stubEnv("PUBLIC_READ_ONLY", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("dry-run lasts 5 minutes, then reads as simulation, with the return time exposed until then", async () => {
    const k = await import("./killswitch");
    expect(k.PUBLIC_MODE_RESET_MS).toBe(5 * MIN);
    k.setKillswitchMode("dry-run", T0);
    expect(k.getKillswitchRevertAt(T0)).toBe(T0 + 5 * MIN);
    expect(k.getKillswitchMode(T0 + 5 * MIN - 1)).toBe("dry-run");
    expect(k.getKillswitchMode(T0 + 5 * MIN)).toBe("simulation");
    expect(k.getKillswitchRevertAt(T0 + 5 * MIN)).toBeNull();
  });

  it("each change restarts the 5 minutes", async () => {
    const k = await import("./killswitch");
    k.setKillswitchMode("dry-run", T0);
    k.setKillswitchMode("dry-run", T0 + 4 * MIN);
    expect(k.getKillswitchMode(T0 + 6 * MIN)).toBe("dry-run");
    expect(k.getKillswitchMode(T0 + 9 * MIN)).toBe("simulation");
  });

  it("choosing simulation clears the timer", async () => {
    const k = await import("./killswitch");
    k.setKillswitchMode("dry-run", T0);
    k.setKillswitchMode("simulation", T0 + MIN);
    expect(k.getKillswitchRevertAt(T0 + MIN)).toBeNull();
  });

  it("the scheduler, which reads the mode every tick, sees the return (shared across bundles)", async () => {
    const route = await import("./killswitch");
    vi.resetModules();
    const scheduler = await import("./killswitch");
    route.setKillswitchMode("dry-run", T0);
    expect(scheduler.getKillswitchMode(T0 + 5 * MIN)).toBe("simulation");
    expect(route.getKillswitchMode(T0 + 5 * MIN)).toBe("simulation");
  });

  it("live is still refused outright on the public demo", async () => {
    const k = await import("./killswitch");
    expect(() => k.setKillswitchMode("live", T0)).toThrow("PUBLIC_READ_ONLY");
    expect(k.getKillswitchRevertAt(T0)).toBeNull();
  });

  it("locally (not read-only) a chosen mode stays until changed", async () => {
    vi.stubEnv("PUBLIC_READ_ONLY", "false");
    const k = await import("./killswitch");
    k.setKillswitchMode("dry-run", T0);
    expect(k.getKillswitchRevertAt(T0)).toBeNull();
    expect(k.getKillswitchMode(T0 + 60 * MIN)).toBe("dry-run");
  });
});
