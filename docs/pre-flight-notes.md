# Pre-flight notes

Standalone for now — merge into `docs/demo-runbook.md`'s pre-flight
checklist once Phase 6 actually produces that document.

## Before the first live call

Confirm the actual signing scheme for Binance Web3 API and Agentic Wallet
against portal docs. Three isolated functions
(`buildAuthHeaders` in `lib/data/quotes.ts`,
`buildTransactionApiAuthHeaders` and `buildAgenticWalletAuthHeaders` in
`lib/execution/agentic-wallet.ts`) are ready to update if the real scheme
differs from today's header-only assumption — each has a labeled test
that will fail loudly if the assumption was wrong.

Every outbound authenticated request in the codebase now goes through one
of these four isolated functions, no exceptions:
`buildAuthHeaders` (`lib/data/quotes.ts`), `buildTransactionApiAuthHeaders`
and `buildAgenticWalletAuthHeaders` (`lib/execution/agentic-wallet.ts`),
and `buildGroqAuthHeaders` (`lib/llm/groq-client.ts`). Groq's Bearer
scheme is documented and correct, not in question — it's isolated for
consistency, not because it needs verifying.
