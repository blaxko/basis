# Basis

## For judges: start here

**Live demo: https://basis-production-c229.up.railway.app** (no wallet, deposit or sign-up needed). The landing page explains Basis and shows the live reading, and four pages go deeper (`/how-it-works`, `/guardrails`, `/findings`, `/faq`); the dashboard is at **https://basis-production-c229.up.railway.app/app**.

Basis watches the two PancakeSwap pools where MSFTB (tokenized Microsoft stock) trades on BNB Chain, and would only trade when the price gap between them beats every cost: both pools' fees, slippage and gas. So far, on every reading, the gap has been far smaller than those costs, so Basis correctly says no, and records why.

**Try it**

1. Open the dashboard (**Open the dashboard** on the landing page, or `/app`). In the **Instruction** box, click an example instruction, then **Send**.
2. Watch the **Guardrail Gate** and the **Audit Ledger** update, about 10 seconds later.
3. Try **Buy $1000 of MSFT** to see a safety block: it's over the $500 per-trade limit.

**This demo can't trade, on purpose. See the real trade:** <!-- demo-video -->demo video (link coming soon)<!-- /demo-video --> and the four transactions of the $5 mainnet round trip, listed under [Status](#status). A plain-language guide to every panel: [`docs/how-to-use.md`](docs/how-to-use.md).

## What Basis is

An autonomous agent that watches the two PancakeSwap V3 pools for **MSFTB** (bStocks' tokenized Microsoft) on BNB Smart Chain and decides whether the price gap between them is worth trading, after every cost: both pools' fees, slippage and live gas. Every decision, including "no", goes through a guardrail gate and into an audit ledger.

Built for the BNB Chain Tokenized Stocks hackathon on the **Binance Web3 API**:

- **Trading API**: `GET /api/v1/dex/aggregator/quote` on every scheduler tick and every typed instruction, as the cross-check price for the `referencePrice` guardrail (not fully independent: the aggregator can route through the same pools).
- **Market API, RWA Data**: `GET /api/v1/dex/market/rwa/underlying-market` on every tick and every typed instruction, feeding the `marketStatus` guardrail.
- **Transaction API**: `pre-transaction/simulate` on our own swap calldata before every send, and `pre-transaction/broadcast-transaction` with MEV protection as the only broadcast path. So far these ran only in the local execution test (the four mainnet transactions under [Status](#status)); dry-run also calls simulate, but only for an order with a positive net edge, and none has had one.

**What runs on the deployed site:** `aggregator/quote` and `rwa/underlying-market`, every 30 seconds and for each typed instruction, plus BSC RPC reads of the two pools. It holds no key, so it never signs or broadcasts; its [`/api/status`](https://basis-production-c229.up.railway.app/api/status) lists every recent Binance call with its status and latency. **Cross-issuer recorder** (Monitor only: Basis doesn't trade across issuers): every 30 s, `aggregator/quote` buy quotes ($200 of USDT) for xStocks MSFTx and Ondo MSFTon (bStocks MSFTB reuses the tick's own quote); every 5 min, one batched `rwa/price` (confirms each token's issuer and gives its `sharesMultiplier`) and a sell quote per token. About 4.8 extra calls a minute. Readings are per share, from memory, at [`/api/issuers`](https://basis-production-c229.up.railway.app/api/issuers).

## Findings, and what Basis won't do

The landing page keeps these short; the detail is here.

**Tested and rejected**
- **Dividend timing.** On Microsoft's ex-dividend day (20 Aug 2026) the real stock fell, but the bStocks, xStocks and Ondo tokens all rose together by a similar amount. No issuer behaved differently to trade against.
- **Weekend gaps.** Over the weekend of 18–21 Sep 2026, Ondo's and bStocks' Microsoft tokens kept moving together, day by day.
- **The aggregator erases the gap.** Binance's aggregator routes each trade to the best price, which erases the gap between pools. So Basis reads the pools directly.
- **The pool pair starts 1.25% behind** (the 0.25% and 1% fees) before slippage and gas; no reading so far has cleared it.

**Across issuers (monitor only: Basis doesn't trade across issuers)**
- Basis compares Microsoft's token from bStocks (MSFTB) and Ondo (MSFTon) per share, using each token's share multiplier (1.0013140 and 1.0057309, matching each issuer's published figures).
- 115 round trips on fresh quotes (both quotes at most 60 s old), recorded 26–30 Sep 2026: none cleared costs (best −0.013%).
- Only 498 of 5,780 readings were fully valid (28 Sep 2026): Binance's Ondo quote repeatedly returned an implausible price (about $1.03 billion per token). Basis shows "no valid quote" with the reason instead of using it.
- xStocks is excluded: Binance's RWA Data API returns its MSFT token with no platform and a price stamped 8 September.

**What it won't do**
- No two-sided arbitrage. That stays off until it's built and verified.
- No trading from the public demo: it holds no wallet key, and the server refuses live mode.
- No guessing: one stock (Microsoft), one exchange (PancakeSwap V3), two pools.
- No lasting history: the audit log lives in memory and resets on restart.

Next steps: two-sided execution, more verified tokens and pools, persistence for the audit log, and better handling of issuers whose quotes stop outside US market hours.

## Status

- Detection, guardrails, the audit ledger and the dashboard run live.
- **Live arbitrage is disabled** until two-leg execution exists: in live mode every arbitrage order is refused before any approval or send.
- **The live send path is proven on BSC mainnet**: on 2026-09-25 a separate, $5-capped execution test ran an MSFTB round trip, run locally: four transactions, each simulated by Binance and broadcast through Binance with MEV protection, all successful.
  - USDT approve: [`0x9df5a668…62e7`](https://bscscan.com/tx/0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7)
  - Buy 5 USDT → MSFTB: [`0x66aa49fd…c5fe`](https://bscscan.com/tx/0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe)
  - MSFTB approve: [`0xa3dc00ab…0493`](https://bscscan.com/tx/0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493)
  - Sell MSFTB → 4.975 USDT: [`0xc77ffb10…c1ff`](https://bscscan.com/tx/0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff)
  - Full record: [`docs/devex-log.md`](docs/devex-log.md), [`docs/PRD.md`](docs/PRD.md) §16.
- **The public demo is read-only**: it holds no wallet key, so Live is greyed out there; the dashboard says so in one line and the landing page's FAQ explains it. See [`docs/how-to-use.md`](docs/how-to-use.md).

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
