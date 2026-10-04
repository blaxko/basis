# How to use Basis

Plain-language guide to the public demo: the landing page at **https://basis-production-c229.up.railway.app** explains Basis and shows the live reading; the dashboard is at **https://basis-production-c229.up.railway.app/app**. Values shown were observed on 2026-09-25/26; yours will differ. Watch the <!-- demo-video -->demo video (link coming soon)<!-- /demo-video --> for a four-minute walk-through.

## 1. What Basis does

The same token, MSFTB (a token that tracks Microsoft stock), trades in two different pools on PancakeSwap, a crypto exchange on BNB Chain (a *pool* is a pot of two tokens that people swap against). Every 30 seconds Basis reads both pools' prices and asks: if I bought in the cheaper pool and sold in the dearer one, would I make money **after** every cost — both pools' fees, *slippage* (the price moving against you as you trade) and *gas* (the network's transaction fee)? It only proposes a trade when that "net edge" is positive, and even then a set of safety checks (*guardrails*) must all pass. In every reading we checked up to 4 October 2026 it decided **not** to trade, because the two pools charge 0.25% and 1% in fees, 1.25% together, and the price gap between them was smaller than the roughly 1.3% it costs. Every decision, including "no", is written to an audit log (the *Audit Ledger*).

## 2. A tour of the site

**The site.** A landing page, four pages behind its menu, and the dashboard. The landing page and the four pages share one header (the Basis wordmark, which goes back to the overview; the **Open the dashboard** button; the light/dark switch; the menu), one footer and one look. Light or dark follows your device until you choose, and your choice is remembered across the pages. The menu opens the pages, marks the one you're on, and opens GitHub in a new tab.

- **The landing page (`/`):** what Basis is, the live reading (both pool prices, the gross gap, total costs and the net edge, from the dashboard's own API every 30 s), how it works, the six guardrails with their limits, what was tested and rejected, the issuer findings, what it won't do, and a FAQ. Its **Open the dashboard** button opens `/app`. If the live reading can't be fetched it says *"Live reading unavailable."* with a link to the dashboard, and shows no number.
- **The four pages (`/how-it-works`, `/guardrails`, `/findings`, `/faq`):** the fuller version of each topic. *How it works* has the three steps in detail, the cost formula with a worked example from the live reading (with its time; "Live reading unavailable." if there's none), and which Binance Web3 API modules are used where. *Guardrails* has each of the six checks: what it measures, its limit, and what happens when it fails. *Findings* has each finding with its data period, how it was measured and why it was rejected. *FAQ* has every question, in groups. They open only from the menu; the landing page doesn't link to them.
- **The dashboard (`/app`):** only the live, working parts. Its top bar has **Basis** (back to the landing page), the light/dark switch and a menu that scrolls to the dashboard's own panels (Live spread, Instruction, Guardrails, Ledger, Issuers). On a wide screen the live reading and the Audit Ledger are on the left, the instruction box and the Guardrail Gate on the right, and the issuer monitor across the bottom. On a phone everything is one column, in that order. Numbers use a fixed-width font so they line up; extra detail sits behind **+** toggles.

**Colours everywhere** (dark surfaces, in BNB Chain's brand palette): **green** = OK / passed, **red** = not OK / blocked, **grey with a dashed outline and a label** = waiting (warming up, pending, or no call yet), **white / neutral** = the checks passed but nothing was sent. **Yellow** marks the main button, the current mode and links; it never means a state.

### Status strip (under the top bar)

One quiet line. On the public demo it starts with **Public demo: read-only · what that means** (the link goes to the landing page's FAQ). Then small **status chips**, each a dot and a label: green = working, red = not working, grey dashed = no call yet.

| Chip | What it means | Normal |
|---|---|---|
| `BSC RPC · ok 12s ago` | The connection to the BNB Chain network (an *RPC* is a node Basis asks for prices and balances), and how its last pool read went. Basis reads the pools at least every 30 seconds, so this stays fresh. | Green, under a minute ago |
| `Binance Web3 API · 120ms` | Binance's API answered the last call, and how fast (ms = thousandths of a second). If it failed it shows why, e.g. `unreachable`. | Green, roughly 100–300 ms on the demo |
| `Groq · ok 2 min ago` | The AI service that reads typed instructions, and how its last real call went: `ok …ago`, `failing (HTTP 401) …ago`, or `no calls yet` (grey) until someone sends an instruction after a restart. | Grey `no calls yet` after a restart, then green |
| `MSFT underlying market · TRADING` | Binance's view of whether Microsoft's real stock is tradable right now. Basis also accepts `MARKET_CLOSED` (it's meant to trade outside stock-market hours). Things like `ASSET_PAUSED` block trading. | Green |

On your own machine (not the public demo) two more chips show the trading wallet's address and its balances; the public demo shows neither.

**Mode switch** (the three-part switch at the end of the strip) — the master switch for how far Basis may go:

- `simulation` — runs the checks only. The default after every restart.
- `dry-run` — also re-reads the pools and asks the exchange and Binance to *simulate* the trade (a rehearsal that changes nothing), but never sends it.
- `live` — would allow sending. **Greyed out with a lock on the public demo** (see section 3).

The highlighted button is the current mode (yellow; red if live). On the public demo the mode is shared by everyone viewing the site, so a change there lasts only 5 minutes: the strip shows *"Returns to simulation at HH:MM UTC"*, and then it switches back by itself. Each new change restarts the 5 minutes; choosing simulation ends it. On your own machine a mode stays until you change it.

### Instruction

Type an order in plain language after the `>` and press **Send**, or click one of the examples under the box to fill it in: `Buy $200 of MSFT` (a normal order), `Buy $1000 of MSFT` (over the per-trade cap), `Buy $100 of NVDA` (no verified pools), `Sell $50 of MSFT` (sells are refused). Other languages work too (French was tested: *"Achète 100 dollars d'actions Microsoft"*). The answer appears right under the box in plain language, with a coloured bar on its left: white = the guardrails passed but nothing was sent (the usual result), red = blocked or failed, grey dashed = can't judge it (warming up, or not something Basis does), green = sent (never on the public demo). **Raw reply** expands to the exact response, for technical readers.

The box's one-line note says the same: the AI (Groq) only reads your sentence into three things: which stock, buy or sell, and how many dollars. Whether anything happens is decided by the guardrails and live market data, never by the AI.

### Live reading (MSFTB / USDT · PancakeSwap V3)

The main panel: four numbers above the chart — the **0.25% pool** and **1% pool** prices, the **gross gap** (the raw price difference between the pools) and, largest, the **net edge after costs** (red below zero, green when it clears; `no opportunity` or `clears threshold` underneath). The green tag `LIVE · N evaluations this session` means real, live data; N goes up by one every 30 seconds for as long as the server runs. The chart holds the last 120 evaluations (about an hour), so after the first hour the tag adds `· chart shows the last 120`. (A grey dashed `HISTORICAL FIXTURE … NOT LIVE` tag means it couldn't read live prices and is showing old sample data.)

- **Chart:** dashed yellow line = gross gap; solid white line = net edge; dashed grey line at 0, labelled `0 = break-even`; dark-red band below zero, labelled `below zero: doesn't clear costs`.
- **Normal:** the net-edge line sits in the dark-red band (around −0.8% to −1.3% on 2026-09-25/28) and the metric says `no opportunity`.

Under the chart, three **+** toggles:

- **Cost breakdown** (its label shows the order size and the total cost): why the net edge is what it is, for the latest evaluation of a $200 order: the **gross gap**, then each cost as a share of the order and in dollars (**buy-side fee** on the cheaper pool, **sell-side fee** on the dearer one, **slippage** as a fixed estimate, **gas** for both swaps, live), their **total**, and **net edge = gross gap + costs**. It's computed on the server with the same functions Basis decides with, so the net edge here is always the one above the chart. Normal on 2026-09-28: gross gap about +0.3%, total costs about −1.30%, net edge about −0.98%.
- **Advisory Feed** (see below).
- **How this is read:** what Basis reads on every evaluation (both pools' prices and liquidity over the BNB Chain RPC, live gas, and Binance's quote for the same purchase, with its latest value), and that it buys the cheaper pool and sells the dearer one, picking the direction on each reading.

### Issuer monitor (across the bottom)

**Monitor only: Basis doesn't trade across issuers.** Microsoft's stock is tokenized by more than one issuer on BNB Chain. This panel compares **bStocks MSFTB** and **Ondo MSFTon** from Binance's quotes for $200 of USDT, **per share**: each token's price divided by its *shares multiplier* (how many shares one token stands for, which grows with dividends; Binance's figure, checked every 5 minutes against the one each issuer publishes).

- **The table:** each issuer's multiplier, buy price per share (every 30 s) and sell price per share (every 5 min, with its age), from the latest reading only.
- **No valid quote:** instead of a number it says `no valid quote` and why, e.g. Binance's only quote was implausible (more than 20% away from bStocks per share), or `Binance: The stock market is currently closed… (code 40367)`, and when the last valid quote was. Ondo often has no valid quote when its market is closed.
- **Gap, latest reading:** which issuer is cheaper per share, and by how much.
- **Would it clear costs?:** buying one issuer and selling the other, after the quotes' own fees and price impact and gas for two swaps. A round trip is estimated only when both of its quotes are at most 60 s old. Sells are quoted every 5 minutes, so most readings show "no estimate" with the sell quote's age and when the next sell quotes are due.
  - **Recorded 26–28 September 2026 (to 20:15 UTC):** 104 valid round trips from fresh quotes. None cleared costs (best −0.013%, median −0.20%).
  - One earlier "cleared costs" result (+0.023%) paired a fresh Ondo buy with a bStocks sell quote 3.5 minutes old. That's why the limit exists.
- **Last hour:** how many readings, how many had a valid price from every issuer, the largest gap and the best round trip.
- **xStocks MSFTx is not included:** Binance's RWA API returns it with no platform and a price last updated 2026-09-08, so it can't be confirmed as xStocks.

### Advisory Feed (a toggle under the chart)

Short lines generated from fixed templates (a sentence pattern filled with real numbers), not written by the AI; it says so when opened:

- the **largest gross gap between the pools in the last hour**, with its time, and the best net edge in that hour;
- the **MSFT underlying market status** from Binance (unchanged since a time, or each change with its time);
- a line for any opportunity that clears the threshold (none up to 4 October 2026).

**Normal:** the two observations and `no opportunities currently clear the threshold.`

### Guardrail Gate

The result of the safety checks for the most recent order.

- **Badge:** `GUARDRAILS PASSED · NOT SENT` (white) with the reason next to it, e.g. `no positive edge (net -1.28%)`; `BLOCKED` (red); `WARMING UP` (grey, dashed outline); `ERROR` (red, dashed outline). `APPROVED · SENT` (green) would mean a trade was actually sent, which the public demo can't do.
- **Each check** is a row: its mark (`[PASS]` green, `[FAIL]` red, `[PENDING]` / `[WARMING UP]` grey), its name, `Limit: …` (the threshold, from the configuration), and what it measured on this order. **What each check does** (a toggle under the rows) explains each one in a sentence.
  - `sanityAndLiquidity` — each pool's price is within 5% of its recent median (after 10 readings), and the thinner pool holds at least $1,000. Measured, e.g. `largest deviation 0.00% · thinner pool $817,334`.
  - `marketStatus` — Binance's RWA status for the stock: passes on `TRADING` and on `MARKET_CLOSED`, blocks paused, limited, maintenance or unknown. Measured: the status code.
  - `referencePrice` — the buy pool's price is within 2% of Binance's quote. Measured, e.g. `0.07% from $519.10 (LiquidMesh)`.
  - `perTradeCap` — the order is at most $500. Measured: the order size.
  - `dailyCap` — today's sent total (UTC) plus this order stays at most $2,000. Measured, e.g. `$0 sent today + $200 = $200`.
  - `dryRunFloor` — the rehearsed trade would return at least 98% of its value. `[PENDING]` (`not simulated yet`) until a rehearsal runs; that's expected.
- **Normal:** `No guardrail evaluations yet — nothing has cleared the opportunity threshold.` In the first 5 minutes after a restart: `WARMING UP … price history x of 10 readings`. After you send an instruction, it shows that order's checks.

### Audit Ledger (under the live reading)

Every decision, newest first, in a scrolling box. The corner shows how many decisions this session. Above the box: **All / Orders / Detections** filters what's shown, and **Export CSV (shown rows)** downloads the rows you're looking at as a spreadsheet file (made in your browser; nothing is sent).

- **Detection rows** — `MSFT — N× detection: no opportunity, no order built`, with a time range, the net-edge range and the latest prices. Repeated "no" decisions in a row are folded into one row per run as they're recorded (with their count, time range and net-edge range, and the latest prices in full), so the ledger's memory stays small however long the server runs; each one is still counted.
- **Guardrail rows** — `MSFT $200 — guardrails passed · not sent (…)` or `MSFT $1000 — BLOCKED (…)`, then what happened, e.g. `no edge: net -0.819% is not positive — nothing sent`.
- Rarer rows: `EXECUTION TEST (not arbitrage)` (only on the local machine) and `tick skipped` (a check ran late).
- **Normal:** one detection row whose count grows every 30 seconds. The panel lists the newest 300 stored rows; since a run of "no" decisions is one row, that reaches back across many hours. Past 300 it says `Showing the newest 300 of N entries.`, and the oldest row reads `… entries shown (older ones not listed)`.

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

1. **Open the site.** The landing page shows the live reading with its time; **Open the dashboard** goes to `/app`. You should see: `Public demo: read-only` at the start of the status strip, and green dots on the chips, including `BSC RPC · ok …s ago`. `Groq` can be grey (`no calls yet`) until someone sends an instruction after a restart; that's normal.
2. **Binance connected.** Look at the `Binance Web3 API · …ms` chip; refresh after 30 seconds. You should see: a number (around 100–300 ms) that changes between refreshes. `unreachable` or `HTTP …` means a problem.
3. **Market status.** Look at the `MSFT underlying market` chip. You should see: `TRADING` or `MARKET_CLOSED` with a green dot.
4. **Live prices updating.** Note the `LIVE · N evaluations` count on the live reading, wait a minute, refresh. You should see: N higher by about 2 (the chart shows the last 120 of them), and a new point at the right end of the chart.
5. **Warm-up finishing.** Only relevant within 5 minutes of a restart. You should see: the Guardrail Gate's `WARMING UP … x of 10 readings` counting up, then disappearing.
6. **Detection rows appearing.** Look at the Audit Ledger. You should see: `MSFT — N× detection: no opportunity, no order built`, the count and the time range growing.
7. **A normal instruction.** Click the example `Buy $200 of MSFT`, then **Send** (section 5, test 1). You should see: a white-bar result under the box starting `Guardrails passed · not sent`, the Guardrail Gate show `GUARDRAILS PASSED · NOT SENT`, the `Groq` chip turn green, and a new ledger row ending `no edge … nothing sent`.
8. **An oversized instruction gets blocked.** Click `Buy $1000 of MSFT`, then **Send** (section 5, test 2). You should see: a red result `Blocked by perTradeCap`, and the Guardrail Gate `BLOCKED` with `perTradeCap` as the only `[FAIL]`.

## 5. Things to try right now

Use the **Instruction** box on the dashboard (`/app`): click an example (it fills the box), then **Send**. Each takes about 2 seconds. The result appears under the box; the Guardrail Gate and Audit Ledger update within about 10 seconds. The demo accepts up to 5 instructions a minute from you; more shows *"Too many requests, wait a minute and try again."* In the first 5 minutes after a restart you'll see *"Still warming up: x of 10 price readings collected"* instead: Basis is collecting a price reading every 30 seconds before it will judge any order.

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
