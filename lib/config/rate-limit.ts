// Fixed-window request limits for routes that trigger Binance or Groq
// calls on a PUBLIC_READ_ONLY deployment. In memory, one process — the
// deployment runs a single instance. Kept on globalThis so every route
// bundle shares one set of counters.
//
// Each limiter has a per-IP limit and a global limit. The global limit is
// the backstop: the client IP comes from a proxy header, and if that
// header can be spoofed, per-IP counting alone could be bypassed.

export interface RateLimitRule {
  name: string;
  perIp: number;
  global: number;
  windowMs: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; scope: "ip" | "global" };

interface Window {
  start: number;
  count: number;
}

const STATE_KEY = Symbol.for("basis.rateLimit.windows");

function windows(): Map<string, Window> {
  const g = globalThis as unknown as Record<symbol, Map<string, Window> | undefined>;
  return (g[STATE_KEY] ??= new Map());
}

function hit(key: string, limit: number, windowMs: number, now: number): number | null {
  const map = windows();
  const w = map.get(key);
  if (!w || now - w.start >= windowMs) {
    map.set(key, { start: now, count: 1 });
    return null;
  }
  if (w.count >= limit) return Math.ceil((w.start + windowMs - now) / 1000);
  w.count += 1;
  return null;
}

export function checkRateLimit(rule: RateLimitRule, ip: string, now: number = Date.now()): RateLimitResult {
  // Per-IP first: a client already over its own limit must not keep using
  // up the shared global quota and lock everyone else out.
  const ipRetry = hit(`${rule.name}|${ip}`, rule.perIp, rule.windowMs, now);
  if (ipRetry !== null) return { ok: false, retryAfterSeconds: ipRetry, scope: "ip" };
  const globalRetry = hit(`${rule.name}|*`, rule.global, rule.windowMs, now);
  if (globalRetry !== null) return { ok: false, retryAfterSeconds: globalRetry, scope: "global" };
  return { ok: true };
}

export function resetRateLimits(): void {
  windows().clear();
}

// The client address as Railway's edge reports it: X-Real-IP. Railway's
// public-networking specs (docs.railway.com/networking/public-networking/
// specs-and-limits, "Request Headers") list "`X-Real-IP` for identifying
// client's remote IP"; they document no X-Forwarded-For. X-Forwarded-For
// (and any other client-settable header) is deliberately NOT read: a
// client can send any value there.
//
// Railway's docs don't say in so many words that the edge overwrites a
// client-supplied X-Real-IP — verify after deploying
// (docs/pre-flight-notes.md): /api/status echoes the IP it sees for the
// caller, and a forged X-Real-IP must not come back. The global limit is
// the backstop if this is ever spoofable. Without the header (local runs)
// every client shares the "unknown" key.
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// /api/instruction: Groq intent parsing + a Binance quote per request.
export const INSTRUCTION_RATE_LIMIT: RateLimitRule = { name: "instruction", perIp: 5, global: 30, windowMs: 60_000 };

// /api/opportunities: the live preview fetches a Binance quote, shared
// through a 10 s cache. Three dashboard panels poll it every 10–15 s
// (~16 requests a minute per open tab), so the per-IP limit leaves room
// for a couple of tabs.
export const OPPORTUNITIES_RATE_LIMIT: RateLimitRule = { name: "opportunities", perIp: 40, global: 600, windowMs: 60_000 };
