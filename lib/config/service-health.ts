// Real recent health of the services the dashboard header shows as chips:
// when the last call succeeded, when the last one failed, and why (a
// short public reason, never raw error text). Recorded where the calls
// are made — Groq in lib/llm/groq-client.ts, the BSC RPC on every pool
// read in lib/data/quotes.ts — and read by /api/status.
//
// In memory, on globalThis so the scheduler bundle (which makes most RPC
// reads) and the API routes share one record, like the killswitch.

export type Service = "groq" | "bscRpc";

export interface ServiceHealth {
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastFailure: string | null;
}

const STATE_KEY = Symbol.for("basis.serviceHealth");

function state(): Record<Service, ServiceHealth> {
  const g = globalThis as unknown as Record<symbol, Record<Service, ServiceHealth> | undefined>;
  return (g[STATE_KEY] ??= { groq: empty(), bscRpc: empty() });
}

function empty(): ServiceHealth {
  return { lastOkAt: null, lastFailAt: null, lastFailure: null };
}

export function recordServiceOk(service: Service, now: number = Date.now()): void {
  state()[service].lastOkAt = new Date(now).toISOString();
}

export function recordServiceFailure(service: Service, reason: string, now: number = Date.now()): void {
  const s = state()[service];
  s.lastFailAt = new Date(now).toISOString();
  s.lastFailure = reason;
}

export function getServiceHealth(service: Service): ServiceHealth {
  return { ...state()[service] };
}

export function resetServiceHealth(): void {
  const s = state();
  s.groq = empty();
  s.bscRpc = empty();
}
