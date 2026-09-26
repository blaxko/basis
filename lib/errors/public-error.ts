// What an error may look like once it can reach a visitor: the dashboard,
// the instruction box's "Raw reply", or any JSON an API route returns.
//
// Raw errors carry things a public page must never show. viem's RPC errors
// embed the RPC URL (a paid endpoint's key is often in its path), the
// request body and a docs link, over many lines; fetch failures carry
// hostnames and ports. So:
//   - a visitor gets a short, plain phrase: plainNetworkReason() for
//     network failures, safeDetail() where the first line is meaningful;
//   - the full text goes to the server log only, via logServerError(),
//     with URLs and secrets redacted there too.
// test/public-errors.test.ts fails on any raw `err.message` outside this
// file.

// Env vars whose values must never appear in a message, even in the log.
// TRADING_WALLET_PRIVATE_KEY is deliberately not read here: read-only
// mode must never read it (test/read-only-mode.test.ts), and any private
// key is caught by HEX64_PATTERN below anyway.
const SECRET_ENV_VARS = ["BSC_RPC_URL", "BINANCE_WEB3_API_KEY", "BINANCE_WEB3_API_SECRET", "BINANCE_WEB3_API_BASE_URL", "GROQ_API_KEY"] as const;

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi;
// A private key (with or without 0x) or any other 64-hex secret.
const HEX64_PATTERN = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
const MAX_DETAIL_CHARS = 160;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Removes URLs, the values of the secret env vars above (and their
// scheme-less forms, e.g. an RPC host+path), and 64-hex strings.
export function redactSecrets(text: string): string {
  let out = text;
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name]?.trim();
    if (!value || value.length < 6) continue;
    const variants = new Set([value, value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")]);
    for (const v of variants) out = out.replace(new RegExp(escapeRegExp(v), "g"), "[redacted]");
  }
  return out.replace(URL_PATTERN, "[url]").replace(HEX64_PATTERN, "[redacted]");
}

function fullText(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (cause: ${err.cause.message})` : err.cause !== undefined ? ` (cause: ${String(err.cause)})` : "";
    return `${err.name}: ${err.message}${cause}`;
  }
  return String(err);
}

// "timed out", "network error" or "unexpected error" —
// never the error's own text.
export function plainNetworkReason(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const text = fullText(err);
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out|timeout/i.test(text)) return "timed out";
  if (/fetch failed|HTTP request failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|network|bad port|Failed to fetch/i.test(text)) {
    return "network error";
  }
  return "unexpected error";
}

// The first line of the error's message, redacted and capped — for errors
// whose first line is meaningful to a reader (e.g. "insufficient funds").
export function safeDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = (raw.split("\n").find((l) => l.trim() !== "") ?? "").trim();
  const redacted = redactSecrets(firstLine);
  return redacted.length > MAX_DETAIL_CHARS ? `${redacted.slice(0, MAX_DETAIL_CHARS - 1)}…` : redacted || "unknown error";
}

// The whole error, stack included, redacted — server log only.
export function logServerError(context: string, err: unknown): void {
  const stack = err instanceof Error && err.stack ? `\n${err.stack.split("\n").slice(1).join("\n")}` : "";
  console.error(`[basis] ${context}: ${redactSecrets(fullText(err) + stack)}`);
}
