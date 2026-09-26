// A header chip for a service Basis calls (Groq, the BSC RPC), from the
// real outcome of its last call as /api/status reports it — never just
// "a key is set". Pure, so every case is tested (test/service-health.test.ts).

export type ChipState = "ok" | "failing" | "unknown";

export interface ServiceHealthJson {
  configured: boolean;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastFailure: string | null;
}

export function ago(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

export function healthChip(name: string, h: ServiceHealthJson, nowMs: number): { label: string; state: ChipState } {
  if (!h.configured) return { label: `${name} · not configured`, state: "failing" };
  const okAt = h.lastOkAt ? Date.parse(h.lastOkAt) : -Infinity;
  const failAt = h.lastFailAt ? Date.parse(h.lastFailAt) : -Infinity;
  if (h.lastFailAt && failAt > okAt) {
    return { label: `${name} · failing${h.lastFailure ? ` (${h.lastFailure})` : ""} ${ago(h.lastFailAt, nowMs)}`, state: "failing" };
  }
  if (h.lastOkAt) return { label: `${name} · ok ${ago(h.lastOkAt, nowMs)}`, state: "ok" };
  return { label: `${name} · no calls yet`, state: "unknown" };
}
