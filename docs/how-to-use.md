# How to use Basis

Plain-language guide to the dashboard and the public demo at **https://basis-production-c229.up.railway.app**. Values shown were observed on 2026-09-25; yours will differ.

## 1. What Basis does

The same token, MSFTB (a token that tracks Microsoft stock), trades in two different pools on PancakeSwap, a crypto exchange on BNB Chain (a *pool* is a pot of two tokens that people swap against). Every 30 seconds Basis reads both pools' prices and asks: if I bought in the cheaper pool and sold in the dearer one, would I make money **after** every cost — both pools' fees, *slippage* (the price moving against you as you trade) and *gas* (the network's transaction fee)? It only proposes a trade when that "net edge" is positive, and even then a set of safety checks (*guardrails*) must all pass. It usually decides **not** to trade, because the two pools charge 0.25% and 1% in fees, 1.25% together, and the price gap between them is normally far smaller than that. Every decision, including "no", is written to an audit log (the *Audit Ledger*).

## 2. A tour of the dashboard

**Colours everywhere** (on a near-black background, in BNB Chain's brand palette): **green** = OK / passed, **red** = not OK / blocked, **grey with a dashed outline and a label** = waiting (warming up or pending). **Yellow** is only decoration (titles' underlines, links, the main buttons); it never means a state.

### Header (top, dark bar)

**Status chips** — each has a dot: green = working, red = not working.

| Chip | What it means | Normal |
|---|---|---|
| `Public read-only: no sending` | This site can't send transactions (it holds no wallet key). Only shown on the public demo. | Green |
| `Groq` | The AI service that reads typed instructions is configured. | Green |
| `BSC RPC` | The connection to the BNB Chain network (an *RPC* is a node Basis asks for prices and balances) is configured. | Green |
| `Trading wallet 0x0bA5…BB95` | The wallet Basis uses. On the public demo only its public address is known, never its key. | Green |
| `Binance Web3 API · 120ms` | Binance's API answered the last call, and how fast (ms = thousandths of a second). If it failed it shows why, e.g. `unreachable`. | Green, roughly 100–300 ms on the demo |
| `Wallet · 0.0029 BNB · 4.975 USDT · 0 MSFTB` | The wallet's balances read live from the blockchain. BNB pays gas; USDT is a dollar token. | Green |
| `MSFT underlying market · TRADING` | Binance's view of whether Microsoft's real stock is tradable right now. `MARKET_CLOSED` is also fine (Basis is meant to trade outside stock-market hours); things like `ASSET_PAUSED` block trading. | Green |

**Killswitch** (three buttons, top right) — the master switch for how far Basis may go:

- `simulation` — runs the checks only. The default after every restart.
- `dry-run` — also re-reads the pools and asks the exchange and Binance to *simulate* the trade (a rehearsal that changes nothing), but never sends it.
- `live` — would allow sending. **Greyed out on the public demo**, with a note under the buttons saying why (see section 3).

The highlighted button is the current mode (yellow; red if live). On the public demo the mode is shared by everyone viewing the site, so a change there lasts only 5 minutes: the header shows *"Returns to simulation at HH:MM UTC"*, and then it switches back by itself. Each new change restarts the 5 minutes; choosing simulation ends it. On your own machine a mode stays until you change it.

### Give an instruction (the box at the top)

Type an order in plain English and press **Send**, or click one of the examples under the box to fill it in. The answer appears right under the box in plain language, with a coloured bar on its left: green = approved by the guardrails, red = blocked or failed, grey dashed = can't judge it yet (warming up, or a stock Basis doesn't cover). **Raw reply** expands to the exact response, for technical readers.

The AI (Groq) only reads your sentence into three things: which stock, buy or sell, and how many dollars. Whether anything happens is decided by the guardrails and live market data, never by the AI.

### Pool Spread Monitor

The main chart. The green tag `LIVE · N evaluations this session` means real, live data; N goes up by one every 30 seconds. (A grey dashed `HISTORICAL FIXTURE … NOT LIVE` tag means it couldn't read live prices and is showing old sample data.)

- **Reading line** under the tag: both pools' prices, the *gross gap* (the raw price difference), the *net edge* (the gap after all costs — red when below zero, green when it clears), then `no opportunity` or `clears threshold`, and `Binance reference $…` (Binance's own quote for the same purchase, used as a cross-check).
- **Chart:** dashed yellow line = gross gap; solid white line = net edge; grey line at 0, labelled `0 = break-even`; dark-red band below zero, labelled `below zero: doesn't clear costs`.
- **Normal:** the net-edge line sits in the dark-red band (around −0.8% to −1.3% on 2026-09-25/26) and the reading says `no opportunity`.

### Advisory Feed (dark panel)

A one-line summary for each opportunity that clears the threshold. **Normal: empty**, showing `no opportunities currently clear the threshold.` The lines are generated from fixed templates (a sentence pattern filled with the numbers), not written by the AI; the panel says so under its title.

### Guardrail Gate

The result of the safety checks for the most recent order.

- **Badge:** `APPROVED` (green), `BLOCKED` (red), `WARMING UP` (grey, dashed outline), `ERROR` (red, dashed outline).
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

- **Detection rows** — `MSFT — N× detection: no opportunity, no order built`, with a time range, the net-edge range and the latest prices. Repeated "no" decisions are grouped into one row; each is still recorded.
- **Guardrail rows** — `MSFT $200 — guardrail: APPROVED (…)` or `BLOCKED (…)`, then what happened, e.g. `no edge: net -0.819% is not positive — nothing sent`.
- Rarer rows: `EXECUTION TEST (not arbitrage)` (only on the local machine) and `tick skipped` (a check ran late).
- **Normal:** one detection row whose count grows every 30 seconds.

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

1. **Open the site.** You should see: every header chip with a green dot, including `Public read-only: no sending`.
2. **Binance connected.** Look at the `Binance Web3 API · …ms` chip; refresh after 30 seconds. You should see: a number (around 100–300 ms) that changes between refreshes. `unreachable` or `HTTP …` means a problem.
3. **Market status.** Look at the `MSFT underlying market` chip. You should see: `TRADING` or `MARKET_CLOSED` with a green dot.
4. **Live prices updating.** Note the `LIVE · N evaluations` count in the Pool Spread Monitor, wait a minute, refresh. You should see: N higher by about 2, and a new point on the chart.
5. **Warm-up finishing.** Only relevant within 5 minutes of a restart. You should see: the Guardrail Gate's `WARMING UP … x of 10 readings` counting up, then disappearing.
6. **Detection rows appearing.** Look at the Audit Ledger. You should see: `MSFT — N× detection: no opportunity, no order built`, the count and the time range growing.
7. **A normal instruction.** Click the example `Buy $200 of MSFT`, then **Send** (section 5, test 1). You should see: a green result under the box, the Guardrail Gate turn `APPROVED`, and a new ledger row ending `no edge … nothing sent`.
8. **An oversized instruction gets blocked.** Click `Buy $1000 of MSFT`, then **Send** (section 5, test 2). You should see: a red result `Blocked by perTradeCap`, and the Guardrail Gate `BLOCKED` with `perTradeCap` as the only `[FAIL]`.

## 5. Three things to try right now

Use the **Give an instruction** box at the top of the dashboard: click an example (it fills the box), then **Send**. Each takes about 2 seconds. The result appears under the box; the Guardrail Gate and Audit Ledger update within about 10 seconds. The demo accepts up to 5 instructions a minute from you; more shows *"Too many requests, wait a minute and try again."* In the first 5 minutes after a restart you'll see *"Still warming up: x of 10 price readings collected"* instead: Basis is collecting a price reading every 30 seconds before it will judge any order.

**Test 1 — `Buy $200 of MSFT` (approved, nothing sent).**
Under the box (green): *"Approved by all guardrails, but not sent: net edge -0.82% is below zero."* and *"After both pools' fees, slippage and gas, this trade would lose money, so Basis doesn't make it."* Guardrail Gate: `APPROVED`, five `[PASS]` and `dryRunFloor [PENDING]`. Audit Ledger: `MSFT $200 — guardrail: APPROVED (…)` then `no edge: net -0.819% is not positive — nothing sent`.

**Test 2 — `Buy $1000 of MSFT` (over the $500 per-trade cap, blocked).**
Under the box (red): *"Blocked by perTradeCap: order size $1000 exceeds per-trade cap $500."* and *"That's the per-trade limit. Nothing was sent."* Guardrail Gate: `BLOCKED`, `perTradeCap [FAIL]`, the rest `[PASS]` (`dryRunFloor [PENDING]`). A `guardrail: BLOCKED` row in the ledger.

**Test 3 — `Buy $100 of NVDA` (a stock Basis doesn't cover).**
Under the box (grey, dashed): *"No pools known for NVDA; Basis won't guess."* and *"Basis only trades tokens whose exchange pools it has verified on-chain. Today that's MSFT (MSFTB)."* Nothing changes elsewhere on the dashboard.

The net-edge figure will differ from −0.82% at other times; the wording stays the same.

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
- The cost was tiny: 5 USDT went out, 4.975 came back (the two pools' fees), plus about $0.02 of gas.

**What it didn't prove:** that Basis makes money. It was a round trip in *one* pool to test the plumbing, not an arbitrage. Arbitrage stays switched off until both halves of a trade (buy in one pool, sell in the other) are built.

**The evidence** — on *BscScan*, BNB Chain's public record where every transaction is visible (a *transaction hash* is its unique ID):

| Step | Transaction |
|---|---|
| Allow the exchange to use the 5 USDT | [0x9df5a668…62e7](https://bscscan.com/tx/0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7) |
| Buy MSFTB with 5 USDT | [0x66aa49fd…c5fe](https://bscscan.com/tx/0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe) |
| Allow the exchange to use the MSFTB | [0xa3dc00ab…0493](https://bscscan.com/tx/0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493) |
| Sell the MSFTB for 4.975 USDT | [0xc77ffb10…c1ff](https://bscscan.com/tx/0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff) |

Each page shows "Success", the block, the wallet `0x0bA5…BB95`, and the tokens moved. The full technical record, including every Binance reply, is in [`devex-log.md`](devex-log.md).
