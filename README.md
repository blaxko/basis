# Basis

An autonomous agent that watches the two PancakeSwap V3 pools for **MSFTB** (bStocks' tokenized Microsoft) on BNB Smart Chain and decides whether the price gap between them is worth trading, after every cost: both pools' fees, slippage and live gas. Every decision, including "no", goes through a guardrail gate and into an audit ledger.

Built for the BNB Chain Tokenized Stocks hackathon on the **Binance Web3 API**:

- **Trading API**: `GET /api/v1/dex/aggregator/quote` on every scheduler tick, as the cross-check price for the `referencePrice` guardrail (not fully independent: the aggregator can route through the same pools).
- **Transaction API**: `pre-transaction/simulate` on our own swap calldata in every dry-run and before every send; `pre-transaction/broadcast-transaction` with MEV protection as the only broadcast path.
- **Market API, RWA Data**: `GET /api/v1/dex/market/rwa/underlying-market` on every tick, feeding the `marketStatus` guardrail.

## Status

- Detection, guardrails, the audit ledger and the dashboard run live.
- **Live arbitrage is disabled** until two-leg execution exists: in live mode every arbitrage order is refused before any approval or send.
- **The live send path is proven on BSC mainnet**: on 2026-09-25 a separate, $5-capped execution test ran an MSFTB round trip, four transactions, each simulated by Binance and broadcast through Binance with MEV protection. Hashes and the full record: [`docs/devex-log.md`](docs/devex-log.md), [`docs/PRD.md`](docs/PRD.md) §16.

## Run it locally

Requirements: Node.js 24 (pinned in `package.json` `engines`), a Binance Web3 API key and secret, a Groq API key, a BSC RPC URL.

```sh
npm install
cp .env.example .env.local   # then fill it in; see the comments in .env.example
npx next build
npx next start                # http://localhost:3000
```

- Use the production build (`next build` + `next start`), not `next dev`.
- After a start, allow **5 minutes** of warm-up: the scheduler evaluates every 30 s and orders need 10 price readings.
- The killswitch starts in `simulation` on every start. Nothing is sent in `simulation` or `dry-run`.
- `TRADING_WALLET_PRIVATE_KEY` is only needed for signing, which only the local, manual execution test does. Leave it out otherwise.
- Binance restricts some regions (web3.binance.com/en/dev-docs/web3-api-prohibited-regions) and flags VPNs and proxies: connect directly.

## Tests

```sh
npx tsc --noEmit
npx vitest run
```

## Deploy (Railway, public and read-only)

The hosted instance runs with `PUBLIC_READ_ONLY=true`: it never reads a trading key, can't be switched to live, answers 403 to the execution test, and rate-limits the routes that call Binance or Groq per client IP.

- **Set it up in the Railway dashboard with [`docs/railway-dashboard-checklist.md`](docs/railway-dashboard-checklist.md)**: Singapore region, one replica, build `npm run build`, start `npx next start -H 0.0.0.0`, healthcheck `/api/health`, Serverless off. Railway's US and Amsterdam regions are all on Binance's restricted list.
- [`.railway/railway.ts`](.railway/railway.ts) documents the same intended settings as Railway Infrastructure as Code, but **it is not applied automatically**: Railway doesn't read it during deploys, and a dashboard setup doesn't use it. It only takes effect if someone runs `railway config plan` / `railway config apply` with the Railway CLI. If you change a setting in the dashboard, update the file (or the checklist) so they don't drift.
- Variables to set in the Railway dashboard: `BINANCE_WEB3_API_KEY`, `BINANCE_WEB3_API_SECRET`, `GROQ_API_KEY`, `BSC_RPC_URL`. The file sets `PUBLIC_READ_ONLY`, `TRADING_WALLET_ADDRESS` and `BINANCE_WEB3_API_BASE_URL`. **Never set `TRADING_WALLET_PRIVATE_KEY` on the host.**
- **Never run a local server and the hosted one against Binance at the same time** (Binance error `40303`).
- Step-by-step deploy and the post-deploy checks (server location, a logged Binance call, the client-IP spoof test): [`docs/pre-flight-notes.md`](docs/pre-flight-notes.md#deploying-to-railway-public-read-only).

## Docs

- [`docs/PRD.md`](docs/PRD.md): product requirements and hackathon rules as verified.
- [`docs/pre-flight-notes.md`](docs/pre-flight-notes.md): demo runbook, execution test, deployment.
- [`docs/config-rationale.md`](docs/config-rationale.md): why each threshold and timeout has its value.
- [`docs/devex-log.md`](docs/devex-log.md): every Binance Web3 API interaction, as raw facts.
