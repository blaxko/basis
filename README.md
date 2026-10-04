# Basis

## For judges: start here

**Live demo: https://basis-production-c229.up.railway.app** (no wallet, deposit or sign-up needed). The landing page explains Basis and shows the live reading, and four pages go deeper (`/how-it-works`, `/guardrails`, `/findings`, `/faq`); the dashboard is at **https://basis-production-c229.up.railway.app/app**.

Basis watches the two PancakeSwap pools where MSFTB (tokenized Microsoft stock) trades on BNB Chain, and would only trade when the price gap between them beats every cost: both pools' fees, slippage and gas. In every reading we checked up to 4 October 2026, the gap was smaller than those costs, so Basis said no, and recorded why.

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
- **Transaction API**: `pre-transaction/simulate` on our own swap calldata before every send, and `pre-transaction/broadcast-transaction` with MEV protection as the only broadcast path. So far these ran only in the local execution test (the four mainnet transactions under [Status](#status)); dry-run also calls simulate, but only for an order with a positive net edge, and up to 4 October 2026 none had one.

**What runs on the deployed site:** `aggregator/quote` and `rwa/underlying-market`, every 30 seconds and for each typed instruction, plus BSC RPC reads of the two pools. It holds no key, so it never signs or broadcasts; its [`/api/status`](https://basis-production-c229.up.railway.app/api/status) lists every recent Binance call with its status and latency. **Cross-issuer recorder** (Monitor only: Basis doesn't trade across issuers): every 30 s, `aggregator/quote` buy quotes ($200 of USDT) for xStocks MSFTx and Ondo MSFTon (bStocks MSFTB reuses the tick's own quote); every 5 min, one batched `rwa/price` (confirms each token's issuer and gives its `sharesMultiplier`) and a sell quote per token. About 4.8 extra calls a minute. Readings are per share, from memory, at [`/api/issuers`](https://basis-production-c229.up.railway.app/api/issuers).

## Findings, and what Basis won't do

The landing page keeps these short; the detail is here.

**Tested and rejected**
- **Dividend timing.** On Microsoft's ex-dividend day (20 Aug 2026), real bStocks and Ondo token prices moved together, in the same direction and by a similar amount, while only the real stock dropped. No issuer lagged to trade against.
- **Weekend gaps.** Over the weekend of 18–21 Sep 2026, Ondo's and bStocks' Microsoft tokens kept moving together, day by day.
- **The aggregator erases the gap.** Binance's aggregator routes each trade to the best price, which erases the gap between pools. So Basis reads the pools directly.
- **The pool pair starts 1.25% behind** (the 0.25% and 1% fees) before slippage and gas. In every reading we checked up to 4 October 2026 (25–30 Sep and 3–4 Oct 2026) the net edge was below zero: about −0.5% to −1.3%. On 3–4 Oct the gap widened to about 0.7–0.8%, still short of the roughly 1.3% it costs. An early reading, before the live readings began, put the pools 0.71% apart ($3.56), which the 1% pool's fee alone exceeded.

**Across issuers (monitor only: Basis doesn't trade across issuers)**
- Basis compares Microsoft's token from bStocks (MSFTB) and Ondo (MSFTon) per share, using each token's share multiplier (1.0013140 and 1.0057309, matching each issuer's published figures).
- Up to 4 October 2026: 222 round trips on fresh quotes (both quotes at most 60 s old), recorded 26–30 Sep and 2–4 Oct 2026, and none cleared costs (best −0.013%, median −0.21%).
- 8,530 of 13,812 readings were fully valid, as of 4 Oct 2026, 11:15 UTC: Binance's Ondo quote often returned an implausible price (about $1.03 billion per token) or failed when the market was closed (Binance error 40367). Basis shows "no valid quote" with the reason instead of using it.
- Not recorded: 29 Sep 20:09–21:54 UTC and 30 Sep 05:48–2 Oct 22:52 UTC. The recorder keeps only the last 24 hours, in memory, and those stretches were lost before an export.
- xStocks is excluded: Binance's RWA Data API returns its MSFT token with no platform and a price stamped 8 September.

**What it won't do**
- No two-sided arbitrage. That stays off until it's built and verified.
- No trading from the public demo: it holds no wallet key, and the server refuses live mode.
- No guessing: one stock (Microsoft), one exchange (PancakeSwap V3), two pools.
- No lasting history: the audit log lives in memory and resets on restart.

Next steps: two-sided execution, more verified tokens and pools, persistence for the audit log, and better handling of issuers whose quotes stop outside US market hours.

## If the net edge turns positive

Up to 4 October 2026 it never did on the live pools, so this is what the code does, and what `test/positive-edge.test.ts` checks end to end on the public, read-only build (real scheduler, guardrail gate, pipeline, ledger and routes; only the pool prices, gas and Binance's replies are replaced; the dashboard's panels are rendered from what the routes return).

1. **Detection** (every 30 s). The net edge is the gap less both pools' fees, slippage and gas. At or below 0.01%, the tick is recorded as `no_opportunity` and no order exists. Above it, but with fewer than 10 price readings per pool (the first ~5 minutes after a restart), it is recorded as `warming_up` and still no order exists.
2. **The order.** Built by fixed code, never by the AI: a buy of $200 on the cheaper pool (only the buy leg is built), carrying both pools' prices and recent readings, the thinner pool's liquidity, Binance's quote for the same purchase and the underlying market's status.
3. **The six guardrails** run on it, and a single failure blocks (`blocked`). With all of them passing, the verdict reads "all runnable guardrail checks passed; pending until simulation: dryRunFloor": five checks pass, and the dry-run floor is *pending* (no simulation exists yet), never a pass.
4. **Two more gates** in the pipeline. An edge below the 0.05% on-chain slippage tolerance stops as `tolerance_exceeds_edge` (an order built and checked, whose edge a swap's minimum-output floor couldn't protect). Otherwise, in **simulation** mode, the default and the only mode that lasts on the public site, it stops as `simulated`: no RPC call, no wallet call.
5. **Dry-run** (if a visitor switches to it; the public demo returns to simulation after 5 minutes): both pools are read again, the spread must still retain half its edge, allowance is checked from the public address, QuoterV2 and Binance's Transaction API simulate the swap, and it stops as `dry_run_only`. Nothing is signed.
6. **Live** is refused on the public site by the server (the killswitch throws, `/api/execution-test` answers 403, `send()` refuses, and the trading key is never read). Even on a local, non-public run, live mode refuses every arbitrage order (`two_leg_execution_not_implemented`): the send path is not reachable from the loop.
7. **What the dashboard shows.** The spread monitor: the net edge in green, "clears threshold", and "Nothing is sent: this build only simulates." The Guardrail Gate: "GUARDRAILS PASSED · NOT SENT" in a neutral colour, five PASS, one PENDING, "preview only, nothing is sent". The Advisory Feed: one line, "…guardrails passed (size $200), but nothing is sent: this demo never sends a trade." The Audit Ledger: a row with `outcome=simulated`, "guardrails passed · not sent" and "no swap was simulated or sent". The landing page's reading: "Above the 0.01% threshold: the guardrails decide next. On this demo nothing is ever sent." Spend is recorded only for an executed trade, so the daily cap is untouched.

## More detail than the pages carry

The four pages (`/how-it-works`, `/guardrails`, `/findings`, `/faq`) are short on purpose. What they leave out is here.

- **Reading.** The last 60 readings of each pool (about 30 minutes) are kept so a sudden jump stands out. The slippage figure is a flat 0.05%, taken from measured $200 trades; gas is a live estimate for both swaps with a 2× safety margin. Every Binance call is signed, and the dashboard's status strip shows how the latest one went.
- **Closed markets.** MSFTB trades on BNB Chain around the clock, so a closed stock market doesn't stop Basis. Only a status of paused, limited, unsupported or in maintenance, or one it can't read, blocks trading.
- **The AI.** Groq's `openai/gpt-oss-120b` only turns a typed sentence into a stock, a side and a dollar amount; the guardrails and live data decide. Sell orders are refused: Basis only evaluates buying the cheaper pool for now.
- **The demo's mode.** Anyone can switch between simulation and dry-run; the change is shared by every visitor and returns to simulation after 5 minutes. Live is locked.
- **The aggregator finding (25 Sep 2026).** Binance's aggregator was asked for the same $200 purchase every 30 seconds for about five minutes: 12 quotes, 05:06 to 05:11 UTC. It chose between a PancakeSwap V3 route and RFQ routes, and the implied price differed by up to $1.40.
- **Ondo quotes.** Binance's quote for Ondo's token has often been unusable: the market was closed (error 40367), or the price came back more than 20% from bStocks per share. Basis rejects it and shows the reason.

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
