# Demo runbook (draft)

Two moments, both on every take.

**Nothing is staged.** Every number on screen is a live read at recording time. If a moment doesn't occur live, it doesn't appear in the video. That means:

- no edited fixtures
- no lowered thresholds
- no pre-seeded ledger or price history
- no replayed takes presented as live

**No live arbitrage in this demo.** Live on-chain arbitrage is disabled until two-leg execution exists. Only the buy leg is built, and a single leg alone doesn't capture the spread. The earlier "Moment C: a real executed trade" is removed. If the killswitch is set to LIVE, every arbitrage order is refused as `two_leg_execution_not_implemented` before any approval or send.

**The live send path is proven on mainnet — as a past, recorded event.** On 2026-09-25 13:23–13:24 UTC the execution test ran a $5 MSFTB round trip (ledger `ledger_1790342672442_26`, outcome `completed`). All four transactions succeeded at 0.05 gwei, each simulated by Binance first and broadcast through Binance with MEV protection:

| Tx | Hash | Block |
|---|---|---|
| USDT approve | `0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7` | 123956296 |
| buy swap | `0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe` | 123956355 |
| MSFTB approve | `0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493` | 123956388 |
| sell swap | `0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff` | 123956404 |

If the video shows these, show them as what they are: the BscScan pages of a run made on 2026-09-25, not a live moment of the recording. The in-memory ledger entry is gone after any restart; the durable record is BscScan and `docs/devex-log.md`.

## Pre-flight

1. **`BSC_RPC_URL` in `.env.local`.** Must be set; with it empty every scheduler tick fails at the pool read.
   - Tested with `https://bsc-dataseed1.defibit.io/` (2026-09-24) and `https://bsc-dataseed.bnbchain.org` (2026-09-25). The `bsc-dataseed.binance.org` endpoint timed out from this machine.
   - Header chip "BSC RPC" should be green.
   - The Pool Spread Monitor tag must say **LIVE**, not "HISTORICAL FIXTURE".
2. **`GROQ_API_KEY`.** Header chip "Groq" green.
   - Model: `openai/gpt-oss-120b`. The previous `llama-3.3-70b-versatile` returns 404 for this key.
3. **`TRADING_WALLET_PRIVATE_KEY`.** Not needed for either moment. Nothing is signed or sent. If set, the header shows the derived address (`0x0bA5…BB95` since 2026-09-25).
4. **Record against a production build.**
   - Run `npx next build`, then `npx next start`. Tested on 2026-09-24: routes answer in about 0.05–1s.
   - Don't use `next dev`. On this machine it compiles on demand (~80s for the page, ~40s per route), and under that load the public RPC timed out.
5. **Restart the server right before recording, then wait at least 5 minutes.**
   - A restart clears the in-memory ledger and price history, and resets the killswitch to `simulation`.
   - The scheduler evaluates every 30 seconds. After 10 evaluations (5 minutes) the price history is warm. Until then:
     - the Guardrail Gate shows **WARMING UP**
     - `/api/instruction` answers HTTP 422 `warming_up`, so moment B can't run yet
   - 5 minutes also gives the chart a series rather than a dot.
6. **Rehearse moment B once, then restart** (step 5 again), so the recorded ledger starts clean.
7. **Use a dependable RPC endpoint if you have one.** The dashboard shares one live read across panels every 10s, and the scheduler adds its own read, including the live gas estimate, every 30s.
8. **Check the gas source.** Detection rows in the Audit Ledger show `gas $0.0xx (live)`. If they show `FALLBACK`, the live gas estimate is failing (usually the RPC), and costs are being overstated with the old flat $0.21.
9. **Binance Web3 API must be reachable.** `BINANCE_WEB3_API_BASE_URL=https://web3.binance.com/build`, key and secret set.
   - Every order is checked against Binance's aggregator quote; with no quote, the `referencePrice` guardrail blocks.
   - **Run `nslookup web3.binance.com` before recording. It must return addresses.** On 2026-09-24 this machine's network DNS (`192.168.0.1`) didn't resolve it, and every Binance call failed until the machine's DNS was pointed at a public resolver (fixed 2026-09-25; see `docs/devex-log.md`).
   - Check on screen: the Pool Spread Monitor's latest line shows `Binance reference $…`, not `Binance reference unavailable (…)`.
   - **Resolving is not enough: the header chip must read `Binance Web3 API · Nms`, green.** On 2026-09-25 from 10:54 UTC, on a network whose DNS server was `172.20.10.1` (a phone hotspot), the name resolved but every TLS handshake to `web3.binance.com` was reset, and the app's calls timed out. `/api/status` → `binanceWeb3Api.calls` shows each call's status and verbatim error.
   - Don't record through a VPN or proxy: Binance answers `40302` ("Proxy or VPN detected").

## Execution test

- **The live execution test (`POST /api/execution-test`) runs locally only.** Never on the deployed instance: there, `PUBLIC_READ_ONLY=true` returns 403 and the server holds no trading key.
- **Procedure used for the 2026-09-25 run** (it worked as written): confirm the last three Binance calls are ok and under 5 s (`/api/status` → `binanceWeb3Api.calls`; the test's health gate refuses otherwise) and `walletBalances` shows MSFTB 0; `POST /api/killswitch {"mode":"live"}`; `POST /api/execution-test {"sizeUsd":5,"confirm":true}` (≈ 61 s for four transactions); `POST /api/killswitch {"mode":"simulation"}` immediately after. If the outcome is `sell_failed`, check any `pendingTxId` on BscScan first, then recover with `{"action":"sell_only","confirm":true}` in live mode.
- **After a run, both router allowances should read 0** (the test approves exact amounts). On 2026-09-25 they did. Binance's simulation of the sell swap listed no MSFTB allowance change even though the allowance was spent: MSFTB emits no `Approval` event on `transferFrom`, so check allowances on-chain, not from the simulation.
- **Wallet after the run:** 0.00290496885 BNB, 4.975031264553765393 USDT, 0 MSFTB. Another round trip needs `sizeUsd` ≤ 4.97 or a USDT top-up (the buy leg checks the balance and stops as `buy_failed`, sending nothing, if short); gas left covers well over 50 more runs at 0.05 gwei.

## Deploying to Railway (public, read-only)

Sources, checked 2026-09-25: Railway docs pages "Infrastructure as Code", "Regions", "Serverless", "Healthchecks", "Public Networking → Specs & Limits", "Deployment actions", "Plans", "Free trial" (docs.railway.com), and railway.com/pricing.

**Rules**

- **Never run the local server and the hosted one against Binance at the same time.** Binance answers `40303` ("Unusual IP activity detected") to "frequent location switching or concurrent multi-region access". Stop the local server before the hosted one is deployed. To run locally again, first stop the hosted one: service → Deployments → the active deployment's menu → **Remove** ("will remove the deployment and stop any further project usage"), then confirm `https://<domain>/api/status` no longer answers.
- The hosted server runs with `PUBLIC_READ_ONLY=true` and has **no trading key**. It can't send transactions, set the killswitch to live, or run the execution test.
- The region is pinned to Singapore (`asia-southeast1-eqsg3a`) in `.railway/railway.ts`. Railway's other regions are US West (California), US East (Virginia) and EU West (**Amsterdam, Netherlands**); all three are on Binance's restricted list. Re-check web3.binance.com/en/dev-docs/web3-api-prohibited-regions before deploying.

**Plan.** Hobby ($5/month minimum usage, includes $5 of usage). Not the Limited Trial: an unverified trial has "restricted outbound network access", and the app needs Binance and the BSC RPC. The Free plan's $1/month credit is below the expected usage (below).

**Steps**

Setting it up in the dashboard instead of the CLI: follow [`railway-dashboard-checklist.md`](railway-dashboard-checklist.md), then run the checks below. The CLI route:

1. In Railway, **Account Settings**: set the preferred region to Southeast Asia (Singapore). The config pins the region anyway; this covers anything created outside it.
2. Create an empty project named `basis` in the dashboard. Install the Railway CLI (the `railway` SDK in this repo requires CLI 5.42.1 or newer), then from the repo root: `railway login`, `railway link` (choose `basis`, environment `production`), `npm install`.
3. `railway config plan` (read-only). Expect exactly: create service `basis` from `blaxko/basis` `main`, build `npm run build`, start `npx next start -H 0.0.0.0`, healthcheck `/api/health`, **one replica in `asia-southeast1-eqsg3a`**, seven variables (values hidden), and nothing marked destructive. Anything else: stop.
   - The four secrets are declared with `preserve()` ("keep the value that is already set in Railway"). The docs don't say what `preserve()` does for a variable that doesn't exist yet; read that part of the plan.
4. `railway config apply` and confirm.
5. In the service's **Variables**, set the four secrets, then deploy the change:
   - `BINANCE_WEB3_API_KEY`, `BINANCE_WEB3_API_SECRET`, `GROQ_API_KEY`, `BSC_RPC_URL`.
   - The file already sets `PUBLIC_READ_ONLY=true`, `TRADING_WALLET_ADDRESS=0x0bA556a253D2f1FdCF352aD55A5b44718802BB95`, `BINANCE_WEB3_API_BASE_URL=https://web3.binance.com/build`.
   - **Never set `TRADING_WALLET_PRIVATE_KEY`.** `PORT` is injected by Railway; don't set it.
   - Until the secrets are set, Binance and RPC calls fail closed; nothing can be sent either way.
6. Service **Settings → Deploy → Serverless**: must be **off** (the default; the config file can't set it).
7. Service **Settings → Networking → Public Networking → Generate Domain**.

**Checks after the first deploy** (stop the local server first)

1. **Read-only.** `curl -s https://<domain>/api/status`: `publicReadOnly` is `true` and `tradingWallet.address` is `0x0bA5…BB95`. Then `POST /api/killswitch {"mode":"live"}` → 403 and `POST /api/execution-test {"sizeUsd":1,"confirm":true}` → 403.
2. **Server location.** `curl -s -D - -o /dev/null https://<domain>/api/health -H "X-Railway-Debug: 1"`: Railway returns `X-Railway-Upstream-Zone` ("the origin zone that served the request"); it must be the Singapore zone. The service's region in the dashboard must read Southeast Asia.
3. **One logged Binance call.** In `/api/status` → `binanceWeb3Api.calls`, the newest calls are HTTP 200, code 0; the header chip shows a latency. A `40301`/`40304` means the host's IP is treated as restricted: remove the deployment (Rules above) and don't retry. Log the first successful hosted call in `docs/devex-log.md`.
4. **Client-IP spoof test.** Railway documents one client-IP header: "`X-Real-IP` for identifying client's remote IP"; it documents no `X-Forwarded-For`. The app reads only `X-Real-IP` (`clientIp()`, `lib/config/rate-limit.ts`). The docs don't say outright that the edge overwrites a client-supplied `X-Real-IP`, so test it:
   - `curl -s https://<domain>/api/status` → note `requestClientIp` (your real IP).
   - `curl -s https://<domain>/api/status -H "X-Real-IP: 1.2.3.4" -H "X-Forwarded-For: 1.2.3.4"` → `requestClientIp` must be the same real IP, not `1.2.3.4`.
   - If it shows `1.2.3.4`, per-IP limits are spoofable (the global cap still holds): fix `clientIp()` before relying on them.
5. **Serverless off.** Settings → Deploy → Serverless is unchecked.

**Expected cost.** Railway bills RAM at $10/GB/month and CPU at $20/vCPU/month ($0.00000386 per GB·s, $0.00000772 per vCPU·s) plus $0.05/GB egress; builds are free. Measured locally (production build, Windows, 14:21–19:37 UTC 2026-09-25, scheduler ticking every 30 s): 117 MB private memory (68 MB working set) and 29.4 CPU-seconds over 5.26 h, an average of 0.0016 vCPU. On Linux expect roughly 0.12–0.2 GB: about $1.2–2.0/month RAM, about $0.03 CPU, cents of egress. That is inside the Hobby plan's included $5, so **about $5/month in total**.

## Moment A: a live `no_opportunity` evaluation

**What's on screen.**

- Pool Spread Monitor, tagged LIVE:
  - the latest reading line (both pool prices, gross gap, net edge, "no opportunity", and Binance's reference price for the same trade)
  - the dashed gross-gap line near zero
  - the solid net-edge line inside the red "doesn't clear costs" band
- Audit Ledger: consecutive detection evaluations are shown as one summary row: count, time range, net edge range, latest pool prices. Every evaluation is still written to the ledger; only the display is collapsed.

**Points to make.**

- The gap between the two pools is real, and so is the gross line.
- The two pools' fees alone are 1.25% for this pair, before slippage and gas, and the gap is a fraction of that. Gas is priced live for both legs; it's cents.
- The detector records each evaluation and builds **no order**. The guardrail gate never runs, because there is nothing to gate.
- The ledger row says "detection", not "guardrail". It is a different kind of entry, on purpose.

**Last observed values** (2026-09-24, ~20:20 UTC): 1% pool $497.00 vs 0.25% pool $497.97, gross gap +0.19%, net edge −1.20% (with the old flat gas). Values at recording time will differ. Read whatever is on screen; don't quote these.

## Moment B: a deliberate guardrail block

Only after the warm-up has completed (pre-flight step 5). Say on camera that this is deliberate: an oversized request, sent to show the per-trade cap working.

```sh
curl -X POST http://localhost:3000/api/instruction \
  -H "Content-Type: application/json" \
  -d '{"instruction":"buy 1000 dollars of MSFT"}'
```

**Why $1,000.** It's above the $500 per-trade cap and below the $2,000 daily cap, so only `perTradeCap` fails. A $5,000 request fails both caps, which muddies the point.

**Expected result.**

- **Response:** HTTP 200 with `"outcome": "blocked"`, `"verdict": { "blockedBy": "perTradeCap", "reason": "order size $1000 exceeds per-trade cap $500", … }`
- **Guardrail Gate panel:** BLOCKED.
  - `sanityAndLiquidity` [PASS], now backed by real price history for both pools
  - `referencePrice` [PASS]: the pool price is within 2% of Binance's live aggregator quote for $1,000. If Binance isn't reachable this is a second [FAIL], which muddies the moment (pre-flight step 9).
  - `perTradeCap` [FAIL]
  - `dailyCap` [PASS]
  - `dryRunFloor` [PENDING]: no simulation runs for a blocked order, so it is honestly not passed
- **Audit Ledger:** a `guardrail: BLOCKED` row, visible between detection summary rows.

**What happens inside.** Groq parses the text into ticker/side/size only. Price, pools and edge come from the live pool read, never from the model. The guardrails run before anything else, so the block is reported even though the live edge is negative.

**If the response is 422 `warming_up`.** The warm-up isn't finished. Wait and retry; don't restart the server.

**If Groq fails.** The response is HTTP 422 `llm_error` and nothing reaches the pipeline. That's correct behavior, but not this moment. Retake.

## Between takes

Restart the server. That resets the ledger, the price history, the killswitch (to `simulation`) and the daily spend. Then repeat pre-flight step 5, including the 5-minute warm-up.
