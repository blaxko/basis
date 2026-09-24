# Demo runbook (draft)

Three moments. The first two happen on every take. The third happens only if the market hands it to us.

**Nothing is staged.** Every number on screen is a live read at recording time. If a moment doesn't occur live, it doesn't appear in the video. That means:

- no edited fixtures
- no lowered thresholds
- no pre-seeded ledger
- no replayed takes presented as live

## Pre-flight

1. **`BSC_RPC_URL` in `.env.local`.** It is currently empty.
   - Tested with `https://bsc-dataseed1.defibit.io/`. The `bsc-dataseed.binance.org` endpoint timed out from this machine.
   - Header chip "BSC RPC" should be green.
   - The Pool Spread Monitor tag must say **LIVE**, not "HISTORICAL FIXTURE".
2. **`GROQ_API_KEY`.** Header chip "Groq" green.
   - The model is now `openai/gpt-oss-120b`. The previous `llama-3.3-70b-versatile` returns 404 for this key.
3. **`TRADING_WALLET_PRIVATE_KEY`.** Header chip "Trading wallet key" green.
   - Only needed for moment C.
   - The wallet was last checked at 0 BNB / 0 USDT. The dashboard doesn't show balances ("Trading Capital: n/a"), so check on BscScan.
4. **Restart the server right before recording.**
   - This clears the in-memory ledger and resets the killswitch to `simulation`.
   - Then let the scheduler run for at least 5 minutes, so the chart shows a series rather than a dot. It makes one evaluation every 30 seconds.
5. **Record against a production build.**
   - Run `npx next build`, then `npx next start`. Tested on 2026-09-24: the build succeeds, the scheduler runs, and routes answer in about 0.05–1s.
   - Don't use `next dev`. On this machine it compiles on demand, which took ~80s for the page and ~40s per route, and recompiles again after any file change. Under that load the public RPC also timed out on a `decimals()` read, and panels sat on "loading".
6. **Dry-run moment B once, then restart again** (step 4), so the recorded ledger starts clean.
7. **Use a dependable RPC endpoint if you have one.** The public endpoint worked in the production-build test but timed out under dev-mode load. The dashboard shares one live read across panels every 10s, and the scheduler adds its own read every 30s.

## Moment A: a live `no_opportunity` evaluation

**What's on screen.**

- Pool Spread Monitor, tagged LIVE:
  - the latest reading line (both pool prices, gross gap, net edge, "no opportunity")
  - the dashed gross-gap line near zero
  - the solid net-edge line inside the red "doesn't clear costs" band
- Audit Ledger: a new `outcome=no_opportunity` detection row about every 30 seconds.

**Points to make.**

- The gap between the two pools is real, and so is the gross line.
- The two pools' fees alone are 1.25% for this pair, before slippage and gas, and the gap is a fraction of that.
- The detector records the evaluation and builds **no order**. The guardrail gate never runs, because there is nothing to gate.
- The ledger row says "detection", not "guardrail". It is a different kind of entry, on purpose.

**Last observed values** (2026-09-24, ~19:45 UTC): 1% pool $497.00 vs 0.25% pool $497.37, gross gap +0.074%, net edge −1.32%. Values at recording time will differ. Read whatever is on screen; don't quote these.

## Moment B: a deliberate guardrail block

Say on camera that this is deliberate: an oversized request, sent to show the per-trade cap working.

```sh
curl -X POST http://localhost:3000/api/instruction \
  -H "Content-Type: application/json" \
  -d '{"instruction":"buy 1000 dollars of MSFT"}'
```

**Why $1,000.** It's above the $500 per-trade cap and below the $2,000 daily cap, so only `perTradeCap` fails. Tested on 2026-09-24 against the production build: `sanityAndLiquidity` PASS, `perTradeCap` FAIL, `dailyCap` PASS, `dryRunFloor` PASS. A $5,000 request fails both caps, which muddies the point.

**Expected result.**

- **Response:** HTTP 200 with `"outcome": "blocked"`, `"verdict": { "blockedBy": "perTradeCap", "reason": "order size $1000 exceeds per-trade cap $500", … }`
- **Guardrail Gate panel:** BLOCKED, with each check listed pass/fail.
- **Audit Ledger:** a `guardrail: BLOCKED` row.

**What happens inside.** Groq parses the text into ticker/side/size only. Price, pools and edge come from the live pool read, never from the model. The guardrails run before anything else, so the block is reported even though the live edge is negative.

**Timing.** The next detection row lands within 30 seconds and pushes the block row down. Show it right away, or scroll.

**If Groq fails.** The response is HTTP 422 `llm_error` and nothing reaches the pipeline. That's correct behavior, but not this moment. Retake.

## Moment C (conditional): a real executed trade

**Only if**, at recording time, the monitor's latest reading shows the net edge **above the threshold** ("clears threshold" in green). That has not happened in any live read so far. If it doesn't happen, skip this moment. Don't lower thresholds or edit fixtures to make it happen.

**Also required.**

- The wallet is funded with BNB for gas and USDT for the $200 order.
- The killswitch is switched to LIVE **on camera**.

**What would happen on the next scheduler tick.**

1. The detector builds a $200 order.
2. The guardrails run.
3. Both pools are re-read before sending; if the edge has decayed, the outcome is `spread_closed`.
4. The ERC-20 allowance is checked. On first use, an `approve` transaction is sent first.
5. QuoterV2 simulates the swap.
6. `exactInputSingle` is sent through the PancakeSwap V3 SwapRouter.
7. The ledger row carries the transaction hash; verify it on BscScan on camera.

**Known gaps. Decide on these before relying on moment C:**

- **One leg only.** The order buys on the cheap pool. The matching sell on the expensive pool is not built. An executed trade buys MSFTB; it does not capture the spread on its own. Say so if this moment happens.
- **Never run on-chain.** The live allowance, QuoterV2 and send path is covered by tests with a mocked wallet. It has never run against the chain, because no live order has ever reached it: every live edge so far was negative. Its first real run would be on camera.
- **Loose slippage guard.** The on-chain minimum output is simulated output minus 1%. That's loose next to the edges involved; see `docs/config-rationale.md`.

## Between takes

Restart the server. That resets the ledger, the killswitch (to `simulation`) and the daily spend. Then repeat pre-flight steps 4 and 5.
