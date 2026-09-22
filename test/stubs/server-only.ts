// Stub for the "server-only" package under vitest. The real package
// throws unconditionally when imported outside Next.js's webpack build
// (which is what gives it teeth against a client bundle) — under plain
// Node/vitest that resolution never happens, so every test file would
// crash on import. Every lib/llm test genuinely runs in a server-like
// Node context, so this stub is a no-op; the real guard still applies
// to the actual `next build`.
export {};
