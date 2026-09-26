# How to use Basis

Plain-language guide to the dashboard and the public demo at **https://basis-production-c229.up.railway.app**. Values shown were observed on 2026-09-25/26; yours will differ. Watch the <!-- demo-video -->demo video (link coming soon)<!-- /demo-video --> for a four-minute walk-through.

## 1. What Basis does

The same token, MSFTB (a token that tracks Microsoft stock), trades in two different pools on PancakeSwap, a crypto exchange on BNB Chain (a *pool* is a pot of two tokens that people swap against). Every 30 seconds Basis reads both pools' prices and asks: if I bought in the cheaper pool and sold in the dearer one, would I make money **after** every cost — both pools' fees, *slippage* (the price moving against you as you trade) and *gas* (the network's transaction fee)? It only proposes a trade when that "net edge" is positive, and even then a set of safety checks (*guardrails*) must all pass. So far it has always decided **not** to trade, because the two pools charge 0.25% and 1% in fees, 1.25% together, and the price gap between them has always been far smaller than that. Every decision, including "no", is written to an audit log (the *Audit Ledger*).

## 2. A tour of the dashboard

**Colours everywhere** (on a near-black background, in BNB Chain's brand palette): **green** = OK / passed, **red** = not OK / blocked, **grey with a dashed outline and a label** = waiting (warming up, pending, or no call yet), **white / neutral** = the checks passed but nothing was sent. **Yellow** is only decoration (titles' underlines, links, the main buttons); it never means a state.

### Header (top, dark bar)

**Status chips** — each has a dot: green = working, red = not working, grey dashed = no call yet.

| Chip | What it means | Normal |
|---|---|---|
| `Public read-only: no sending` | This site can't send transactions (it holds no wallet key). Only shown on the public demo. | Green |
| `Groq · ok 2 min ago` | The AI service that reads typed instructions, and how its last real call went: `ok …ago`, `failing (HTTP 401) …ago`, or `no calls yet` (grey) until someone sends an instruction after a restart. | Grey `no calls yet` after a restart, then green |
| `BSC RPC · ok 12s ago` | The connection to the BNB Chain network (an *RPC* is a node Basis asks for prices and balances), and how its last pool read went. Basis reads the pools at least every 30 seconds, so this stays fresh. | Green, under a minute ago |
| `Trading wallet 0x0bA5…BB95` | The wallet Basis uses. On the public demo only its public address is known, never its key. | Green |
| `Binance Web3 API · 120ms` | Binance's API answered the last call, and how fast (ms = thousandths of a second). If it failed it shows why, e.g. `unreachable`. | Green, roughly 100–300 ms on the demo |
| `Wallet · 0.0029 BNB · 4.975 USDT · 0 MSFTB` | The wallet's balances read live from the blockchain. BNB pays gas; USDT is a dollar token. | Green |
| `MSFT underlying market · TRADING` | Binance's view of whether Microsoft's real stock is tradable right now. Basis also accepts `MARKET_CLOSED` (it's meant to trade outside stock-market hours), though Binance hasn't reported it so far: it said `TRADING` even on Saturday 2026-09-26. Things like `ASSET_PAUSED` block trading. | Green |

**Killswitch** (three buttons, top right) — the master switch for how far Basis may go:

- `simulation` — runs the checks only. The default after every restart.
- `dry-run` — also re-reads the pools and asks the exchange and Binance to *simulate* the trade (a rehearsal that changes nothing), but never sends it.
- `live` — would allow sending. **Greyed out on the public demo**, with a note under the buttons saying why (see section 3).

The highlighted button is the current mode (yellow; red if live). On the public demo the mode is shared by everyone viewing the site, so a change there lasts only 5 minutes: the header shows *"Returns to simulation at HH:MM UTC"*, and then it switches back by itself. Each new change restarts the 5 minutes; choosing simulation ends it. On your own machine a mode stays until you change it.

### Give an instruction (the box at the top)

Type an order in plain language and press **Send**, or click one of the examples under the box to fill it in. Other languages work too (French was tested: *"Achète 100 dollars d'actions Microsoft"*). The answer appears right under the box in plain language, with a coloured bar on its left: white = the guardrails passed but nothing was sent (the usual result), red = blocked or failed, grey dashed = can't judge it (warming up, or not something Basis does), green = sent (never on the public demo). **Raw reply** expands to the exact response, for technical readers.

The AI (Groq) only reads your sentence into three things: which stock, buy or sell, and how many dollars. Whether anything happens is decided by the guardrails and live market data, never by the AI.

### Pool Spread Monitor

The main chart. The green tag `LIVE · N evaluations this session` means real, live data; N goes up by one every 30 seconds for as long as the server runs. The chart itself holds the last 120 evaluations (about an hour), so after the first hour the tag adds `· chart shows the last 120`. (A grey dashed `HISTORICAL FIXTURE … NOT LIVE` tag means it couldn't read live prices and is showing old sample data; the panel then says *"Live pool prices are temporarily unavailable (BNB Chain RPC: …)"*.)

- **Reading line** under the tag: both pools' prices, the *gross gap* (the raw price difference), the *net edge* (the gap after all costs — red when below zero, green when it clears), then `no opportunity` or `clears threshold`, and `Binance reference $…` (Binance's own quote for the same purchase, used as a cross-check).
- **Chart:** dashed yellow line = gross gap; solid white line = net edge; grey line at 0, labelled `0 = break-even`; dark-red band below zero, labelled `below zero: doesn't clear costs`.
- **Normal:** the net-edge line sits in the dark-red band (around −0.8% to −1.3% on 2026-09-25/26) and the reading says `no opportunity`.

### Advisory Feed (dark panel)

A one-line summary for each opportunity that clears the threshold. **Normal: empty**, showing `no opportunities currently clear the threshold.` The lines are generated from fixed templates (a sentence pattern filled with the numbers), not written by the AI; the panel says so under its title.

### Guardrail Gate

The result of the safety checks for the most recent order.

- **Badge:** `GUARDRAILS PASSED · NOT SENT` (white) with the reason next to it, e.g. `no positive edge (net -1.28%)`; `BLOCKED` (red); `WARMING UP` (grey, dashed outline); `ERROR` (red, dashed outline). `APPROVED · SENT` (green) would mean a trade was actually sent, which the public demo can't do.
- **Each check:** `[PASS]` green, `[FAIL]` red, `[PENDING]` / `[WARMING UP]` grey.
  - `sanityAndLiquidity` — prices look sane against recent history and the pools hold enough money.
  - `marketStatus` — Binance says the stock isn't paused or restricted.
  - `referencePrice` — the pool price is within 2% of Binance's quote.
  - `perTradeCap` — the order is at most $500.
  - `dailyCap` — today's total stays at most $2,000.
  - `dryRunFloor` — the rehearsed trade would return at least 98% of its value. `[PENDING]` until a rehearsal runs; that's expected.
- **Normal:** `No guardrail evaluations yet — nothing has cleared the opportunity threshold.` In the first 5 minutes after a restart: `WARMING UP … price history x of 10 readings`. After you send an instruction, it shows that order's checks.

### Audit Ledger (dark panel, bottom)

Every decision, newest first:

- **Detection rows** — `MSFT — N× detection: no opportunity, no order built`, with a time range, the net-edge range and the latest prices. Repeated "no" decisions in a row are folded into one row per run as they're recorded (with their count, time range and net-edge range, and the latest prices in full), so the ledger's memory stays small however long the server runs; each one is still counted.
- **Guardrail rows** — `MSFT $200 — guardrails passed · not sent (…)` or `MSFT $1000 — BLOCKED (…)`, then what happened, e.g. `no edge: net -0.819% is not positive — nothing sent`.
- Rarer rows: `EXECUTION TEST (not arbitrage)` (only on the local machine) and `tick skipped` (a check ran late).
- **Normal:** one detection row whose count grows every 30 seconds. The panel lists the newest 300 entries (about 2.5 hours); after that it says `Showing the newest 300 of N entries.`, and the oldest row reads `… entries shown (older ones not listed)`.

## 3. Public demo vs your own machine

| | Public demo (Railway) | Local (your computer) |
|---|---|---|
| Watch prices, checks and the ledger | Yes | Yes |
| Switch simulation ↔ dry-run | Yes (shared with every viewer) | Yes |
| Send instructions | Yes, up to 5 a minute per person | Yes |
| Switch to live | **No** | Yes |
| Run the $5 execution test | **No** | Yes |

**Why Live isn't clickable on the demo.** The demo is public: anyone can open it and press buttons. So it's deliberately built so it *can't* move money. It never loads the wallet's secret key, so it has nothing to sign a transaction with. And if someone bypassed the greyed-out button, the server itself refuses (it answers "forbidden"). The live path was instead proven on your own machine (section 6). One more rule: never run your local copy and the public demo at the same time, because Binance flags the same key calling from two places at once.

## 4. "Is it working?" checklist (public demo)

1. **Open the site.** You should see: green dots on the header chips, including `Public read-only: no sending` and `BSC RPC · ok …s ago`. `Groq` can be grey (`no calls yet`) until someone sends an instruction after a restart; that's normal.
2. **Binance connected.** Look at the `Binance Web3 API · …ms` chip; refresh after 30 seconds. You should see: a number (around 100–300 ms) that changes between refreshes. `unreachable` or `HTTP …` means a problem.
3. **Market status.** Look at the `MSFT underlying market` chip. You should see: `TRADING` or `MARKET_CLOSED` with a green dot.
4. **Live prices updating.** Note the `LIVE · N evaluations` count in the Pool Spread Monitor, wait a minute, refresh. You should see: N higher by about 2 (the chart shows the last 120 of them), and a new point at the right end of the chart.
5. **Warm-up finishing.** Only relevant within 5 minutes of a restart. You should see: the Guardrail Gate's `WARMING UP … x of 10 readings` counting up, then disappearing.
6. **Detection rows appearing.** Look at the Audit Ledger. You should see: `MSFT — N× detection: no opportunity, no order built`, the count and the time range growing.
7. **A normal instruction.** Click the example `Buy $200 of MSFT`, then **Send** (section 5, test 1). You should see: a white-bar result under the box starting `Guardrails passed · not sent`, the Guardrail Gate show `GUARDRAILS PASSED · NOT SENT`, the `Groq` chip turn green, and a new ledger row ending `no edge … nothing sent`.
8. **An oversized instruction gets blocked.** Click `Buy $1000 of MSFT`, then **Send** (section 5, test 2). You should see: a red result `Blocked by perTradeCap`, and the Guardrail Gate `BLOCKED` with `perTradeCap` as the only `[FAIL]`.

## 5. Things to try right now

Use the **Give an instruction** box at the top of the dashboard: click an example (it fills the box), then **Send**. Each takes about 2 seconds. The result appears under the box; the Guardrail Gate and Audit Ledger update within about 10 seconds. The demo accepts up to 5 instructions a minute from you; more shows *"Too many requests, wait a minute and try again."* In the first 5 minutes after a restart you'll see *"Still warming up: x of 10 price readings collected"* instead: Basis is collecting a price reading every 30 seconds before it will judge any order.

**Test 1 — `Buy $200 of MSFT` (guardrails pass, nothing sent).**
Under the box (white bar): *"Guardrails passed · not sent: no positive edge (net edge -0.82%)."* and *"After both pools' fees, slippage and gas, this trade would lose money, so Basis doesn't make it."* Guardrail Gate: `GUARDRAILS PASSED · NOT SENT` with `no positive edge (net -0.82%)`, five `[PASS]` and `dryRunFloor [PENDING]`. Audit Ledger: `MSFT $200 — guardrails passed · not sent (…)` then `no edge: net -0.819% is not positive — nothing sent`.

**Test 2 — `Buy $1000 of MSFT` (over the $500 per-trade cap, blocked).**
Under the box (red): *"Blocked by perTradeCap: order size $1000 exceeds per-trade cap $500."* and *"That's the per-trade limit. Nothing was sent."* Guardrail Gate: `BLOCKED`, `perTradeCap [FAIL]`, the rest `[PASS]` (`dryRunFloor [PENDING]`). A `MSFT $1000 — BLOCKED (…)` row in the ledger.

**Test 3 — `Buy $100 of NVDA` (a stock Basis doesn't cover).**
Under the box (grey, dashed): *"No pools known for NVDA; Basis won't guess."* and *"Basis only trades tokens whose exchange pools it has verified on-chain. Today that's MSFT (MSFTB)."* Nothing changes elsewhere on the dashboard.

The net-edge figure will differ from −0.82% at other times; the wording stays the same.

**Unusual instructions, and what you'll see** (none of them changes anything elsewhere on the dashboard):

| You type | Under the box |
|---|---|
| `sell $50 of MSFT` | *"Basis only buys the cheaper pool leg for now; sells aren't supported."* |
| `buy $0 of MSFT`, or `buy some microsoft` | *"Basis needs a dollar amount above $0, for example: Buy $200 of MSFT."* |
| `buy $100 of GOOGL` | *"Basis only covers Microsoft (MSFT) today."* |
| `purple monkey dishwasher` | *"That doesn't look like an order. Try: Buy $200 of MSFT."* |
| `Achète 100 dollars d'actions Microsoft` | Read as buy $100 of MSFT, then judged like test 1. |

If the BNB Chain connection is down, a valid order gets *"Live price data is temporarily unavailable for MSFT, so nothing was evaluated."*; if the AI service is down, *"The AI couldn't read the instruction right now, so nothing was evaluated."*

**Alternative: send instructions from Git Bash** (installed with Git for Windows). Paste one line; the reply is the same as the box's **Raw reply**:

```sh
curl -s -X POST https://basis-production-c229.up.railway.app/api/instruction -H "Content-Type: application/json" -d '{"instruction":"Buy $200 of MSFT"}'
curl -s -X POST https://basis-production-c229.up.railway.app/api/instruction -H "Content-Type: application/json" -d '{"instruction":"Buy $1000 of MSFT"}'
curl -s -X POST https://basis-production-c229.up.railway.app/api/instruction -H "Content-Type: application/json" -d '{"instruction":"Buy $100 of NVDA"}'
```

Look for `"outcome":"no_edge"`, `"blockedBy":"perTradeCap"` and `"kind":"pool_resolution_failed"` respectively. (From Windows PowerShell, `Invoke-RestMethod -Method Post -Uri "https://basis-production-c229.up.railway.app/api/instruction" -ContentType "application/json" -Body (@{ instruction = 'Buy $200 of MSFT' } | ConvertTo-Json)` works for tests 1 and 2; for test 3 it shows only `(422) Unprocessable Entity`.)

## 6. Explaining the live execution test

**In one breath:** "The public demo can't trade, on purpose. To prove the trading path really works, we ran one tiny real trade on 25 September 2026 from the developer's machine: we bought $5 of MSFTB and sold it straight back, through exactly the code a real trade would use. All four blockchain transactions succeeded, and anyone can check them."

**What it proved:**

- Basis can prepare a real trade, have Binance *simulate* it first (confirm it would succeed without spending anything), sign it with its own key, and send it through Binance with *MEV protection* (sent privately, so bots can't jump ahead of it and move the price).
- The safety limits held: a hard $5 cap per trade in the code, and it only runs when deliberately switched on and confirmed.
- The cost was tiny: 5 USDT went out, 4.975 came back (the 0.25% pool's fee, paid on the buy and again on the sell), plus under $0.02 of gas.

**What it didn't prove:** that Basis makes money. It was a round trip in *one* pool to test the plumbing, not an arbitrage. Arbitrage stays switched off until both halves of a trade (buy in one pool, sell in the other) are built.

**The evidence** — on *BscScan*, BNB Chain's public record where every transaction is visible (a *transaction hash* is its unique ID):

| Step | Transaction |
|---|---|
| Allow the exchange to use the 5 USDT | [0x9df5a668…62e7](https://bscscan.com/tx/0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7) |
| Buy MSFTB with 5 USDT | [0x66aa49fd…c5fe](https://bscscan.com/tx/0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe) |
| Allow the exchange to use the MSFTB | [0xa3dc00ab…0493](https://bscscan.com/tx/0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493) |
| Sell the MSFTB for 4.975 USDT | [0xc77ffb10…c1ff](https://bscscan.com/tx/0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff) |

Each page shows "Success", the block, the wallet `0x0bA5…BB95`, and the tokens moved. The full technical record, including every Binance reply, is in [`devex-log.md`](devex-log.md).
