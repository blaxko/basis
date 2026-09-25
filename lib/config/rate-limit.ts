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

// The client address as Render's proxy reports it: the FIRST entry of
// X-Forwarded-For. Render staff, on "Send the correct X_FORWARDED_FOR"
// (feedback.render.com/features/p/send-the-correct-xforwardedfor, status
// Complete, reply of 2021-05-28): "we set the first IP in the list to the
// real client IP". Render's DDoS article
// (render.com/articles/how-render-handles-ddos-attacks) says to read the
// client IP from x-forwarded-for, without naming the entry. The LAST
// entry is not used: traffic passes through Cloudflare and Render's load
// balancers, so it can be a proxy address shared by every client.
//
// This rests on a staff reply, not formal docs — verify after deploying
// (docs/pre-flight-notes.md): /api/status echoes the IP it sees for the
// caller. No other header (X-Real-IP, CF-Connecting-IP) is read: Render
// doesn't document them. The global limit is the backstop if this is
// ever spoofable.
export function clientIp(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

// /api/instruction: Groq intent parsing + a Binance quote per request.
export const INSTRUCTION_RATE_LIMIT: RateLimitRule = { name: "instruction", perIp: 5, global: 30, windowMs: 60_000 };

// /api/opportunities: the live preview fetches a Binance quote, shared
// through a 10 s cache. Three dashboard panels poll it every 10–15 s
// (~16 requests a minute per open tab), so the per-IP limit leaves room
// for a couple of tabs.
export const OPPORTUNITIES_RATE_LIMIT: RateLimitRule = { name: "opportunities", perIp: 40, global: 600, windowMs: 60_000 };
