import { buildAuthHeaders, getConfig, type BinanceWeb3ApiConfig } from "./quotes";

// Every runtime Binance Web3 API call goes through binanceRequest(), which
// signs it and records one entry per call: time, endpoint, HTTP status,
// latency, the API's own code, and verbatim error text. The log is bounded
// and in memory, on globalThis so the scheduler bundle and the API routes
// share it (same reason as defaultLedger). Exposed via GET /api/status.

export interface BinanceCallRecord {
  at: string; // ISO time the request started
  method: "GET" | "POST";
  path: string; // e.g. /api/v1/dex/aggregator/quote — the base URL is omitted
  query: string; // no secrets here: chain, amounts, token and wallet addresses
  httpStatus: number | null; // null when no HTTP response arrived
  latencyMs: number;
  apiCode: number | null; // the response's `code` field, when parseable
  ok: boolean; // HTTP 2xx and code 0
  error?: string; // verbatim: response body for non-2xx, `msg` for code != 0, or the thrown error
}

export const MAX_CALL_RECORDS = 200;
const MAX_ERROR_CHARS = 4000;

export class BinanceCallLog {
  private records: BinanceCallRecord[] = [];

  record(entry: BinanceCallRecord): void {
    this.records.push(entry);
    if (this.records.length > MAX_CALL_RECORDS) this.records.splice(0, this.records.length - MAX_CALL_RECORDS);
  }

  recent(limit = MAX_CALL_RECORDS): BinanceCallRecord[] {
    return this.records.slice(-limit);
  }
}

const CALL_LOG_KEY = Symbol.for("basis.binanceCallLog.default");
export const defaultBinanceCallLog: BinanceCallLog = ((globalThis as unknown as Record<symbol, BinanceCallLog | undefined>)[
  CALL_LOG_KEY
] ??= new BinanceCallLog());

export interface BinanceResponse {
  httpStatus: number;
  body: { code?: number; msg?: string; data?: unknown } | null;
  text: string;
  latencyMs: number;
}

export interface BinanceClientDeps {
  fetchFn: typeof fetch;
  getConfigFn: () => BinanceWeb3ApiConfig;
  callLog: BinanceCallLog;
  now: () => number;
}

export const defaultBinanceClientDeps: BinanceClientDeps = {
  fetchFn: (...args) => fetch(...args),
  getConfigFn: getConfig,
  callLog: defaultBinanceCallLog,
  now: () => performance.now(),
};

const TIMEOUT_MS = 10_000;

// Throws on missing credentials (before any request, nothing logged) and
// on network failure (logged, then rethrown). Otherwise returns whatever
// came back — non-2xx and non-zero `code` included — for the caller to
// judge; it is logged either way.
export async function binanceRequest(
  request: { method: "GET" | "POST"; path: string; query?: URLSearchParams; body?: unknown },
  deps: BinanceClientDeps = defaultBinanceClientDeps
): Promise<BinanceResponse> {
  const config = deps.getConfigFn();
  const query = request.query?.toString() ?? "";
  const url = `${config.baseUrl}${request.path}${query ? `?${query}` : ""}`;
  const bodyText = request.body === undefined ? "" : JSON.stringify(request.body);
  const headers: Record<string, string> = buildAuthHeaders(config.apiKey, config.secretKey, request.method, url, bodyText);
  if (bodyText) headers["Content-Type"] = "application/json";

  const at = new Date().toISOString();
  const t0 = deps.now();
  const base = { at, method: request.method, path: request.path, query };

  let res: Response;
  let text: string;
  try {
    res = await deps.fetchFn(url, {
      method: request.method,
      headers,
      body: bodyText || undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}${err.cause ? ` (cause: ${String((err.cause as Error).message ?? err.cause)})` : ""}` : String(err);
    deps.callLog.record({ ...base, httpStatus: null, latencyMs: Math.round(deps.now() - t0), apiCode: null, ok: false, error: error.slice(0, MAX_ERROR_CHARS) });
    throw err;
  }
  const latencyMs = Math.round(deps.now() - t0);

  let body: BinanceResponse["body"] = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const apiCode = typeof body?.code === "number" ? body.code : null;
  const ok = res.ok && apiCode === 0;
  const error = ok ? undefined : (!res.ok ? text : `code ${apiCode}: ${body?.msg ?? text}`).slice(0, MAX_ERROR_CHARS);

  deps.callLog.record({ ...base, httpStatus: res.status, latencyMs, apiCode, ok, ...(error !== undefined ? { error } : {}) });
  return { httpStatus: res.status, body, text, latencyMs };
}

// For /api/status: counts and latency percentiles over what's in the log.
export function summarizeCalls(records: readonly BinanceCallRecord[]) {
  const latencies = records.filter((r) => r.httpStatus !== null).map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]! : null);
  return {
    count: records.length,
    ok: records.filter((r) => r.ok).length,
    failed: records.filter((r) => !r.ok).length,
    latencyMs: { p50: pct(50), p95: pct(95), max: latencies.length ? latencies[latencies.length - 1]! : null },
  };
}
