# Demo runbook (draft)

Two moments, both on every take.

**Nothing is staged.** Every number on screen is a live read at recording time. If a moment doesn't occur live, it doesn't appear in the video. That means:

- no edited fixtures
- no lowered thresholds
- no pre-seeded ledger or price history
- no replayed takes presented as live

**No live trade in this demo.** Live on-chain arbitrage is disabled until two-leg execution exists. Only the buy leg is built, and a single leg alone doesn't capture the spread. The earlier "Moment C: a real executed trade" is removed. If the killswitch is set to LIVE, every order is refused as `two_leg_execution_not_implemented` before any approval or send.

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

## Execution test and deployment rules

- **The live execution test (`POST /api/execution-test`) runs locally only.** Never on the deployed instance: there, `PUBLIC_READ_ONLY=true` returns 403 and the server holds no trading key.
- **Never run the local server and the hosted one against Binance at the same time.** Binance answers `40303` ("Unusual IP activity detected") to "frequent location switching or concurrent multi-region access". Stop one before starting the other.
- The deployment is pinned by `render.yaml` to `region: singapore` (Render's default, oregon, is in the US, which Binance restricts; the region can't be changed after the service is created). Before creating it, re-check web3.binance.com/en/dev-docs/web3-api-prohibited-regions.
- Plan `0.5c-512mb` (legacy name *Starter*): 0.5 CPU / 512 MB, $7/month of compute on a Hobby workspace ($0/month), per render.com/pricing on 2026-09-25. Not the free plan, which spins down after 15 idle minutes and would stop the scheduler.
- After the first deploy:
  - Confirm one Binance call succeeds from the host (a `40301` means the host's IP is treated as restricted).
  - Check the client IP the rate limiter uses. It is the FIRST `X-Forwarded-For` entry, per a Render staff reply ("we set the first IP in the list to the real client IP", feedback.render.com/features/p/send-the-correct-xforwardedfor, 2021-05-28), not formal docs. Run `curl -s https://<host>/api/status -H "X-Forwarded-For: 1.2.3.4"` and read `requestClientIp`: it must be your real IP, not `1.2.3.4`. If it shows `1.2.3.4`, per-IP limits are spoofable (the global cap still holds); fix `clientIp()` in `lib/config/rate-limit.ts` before relying on them.

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
