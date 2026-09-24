import "server-only";

// This module talks to Groq with a secret API key and must never reach a
// client bundle. The `server-only` import throws a build-time error if
// anything imports this from client-side code (Next.js enforces this at
// build); see architecture.test.ts for a regression check that this
// import stays in place.

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqChatOptions {
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

// Every failure mode is typed and returned, never thrown — a caller
// should never need a try/catch around chatCompletion(). No retry loop:
// one attempt, one result.
export type GroqChatError =
  | { kind: "not_implemented"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "rate_limit"; message: string }
  | { kind: "http_error"; message: string }
  | { kind: "network_error"; message: string }
  | { kind: "malformed_response"; message: string };

export type GroqChatResult = { ok: true; content: string } | { ok: false; error: GroqChatError };

// Groq's documented and correct auth scheme (unlike its counterparts in
// lib/data/quotes.ts and lib/execution/agentic-wallet.ts, this one isn't
// in question) — isolated into its own function anyway, so every
// outbound authenticated request in this codebase follows the same
// pattern with no exceptions to remember.
export function buildGroqAuthHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

// Thin wrapper around Groq's OpenAI-compatible chat completions endpoint.
// Reads the API key from process.env only, on every call — never
// hardcoded, never cached at module scope, never included in any
// returned/logged message (error messages below report status codes and
// generic text only, never request headers or the key).
export async function chatCompletion(
  messages: GroqChatMessage[],
  options: GroqChatOptions = {}
): Promise<GroqChatResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: {
        kind: "not_implemented",
        message:
          "NotImplemented: GROQ_API_KEY is not set. This client is built against Groq's " +
          "documented chat completions shape but has no live credentials configured yet " +
          "— see .env.example.",
      },
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        ...buildGroqAuthHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_MODEL,
        temperature: options.temperature ?? 0,
        messages,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      return { ok: false, error: { kind: "rate_limit", message: "Groq API rate limit exceeded (429)" } };
    }

    if (!res.ok) {
      // Deliberately no response body in the message: a Groq error body
      // can echo back parts of the request, which must never surface in
      // logs or return values (PRD rule 10).
      return {
        ok: false,
        error: { kind: "http_error", message: `Groq API request failed: ${res.status} ${res.statusText}` },
      };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return {
        ok: false,
        error: { kind: "malformed_response", message: "Groq API response did not contain a message content string" },
      };
    }

    return { ok: true, content };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { kind: "timeout", message: `Groq API request timed out after ${timeoutMs}ms` } };
    }
    return {
      ok: false,
      error: { kind: "network_error", message: err instanceof Error ? err.message : "unknown network error" },
    };
  } finally {
    clearTimeout(timer);
  }
}
