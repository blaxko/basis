# Basis — Product Requirements Document

**One-liner:** Cross-pool gaps, counted only after every cost.
**Hackathon:** BNB Hack: Tokenized Stocks Edition (Sep 16 – Oct 11, 2026)
**Track:** Single track — tokenized stock products and agents on BSC

---

## 1. Problem Statement

Tokenized equities landed on BNB Chain faster than the tooling around them. Basis started from a different premise than it ships with: that multiple protocols (xStocks, bStocks, Ondo) represent the same underlying stock with genuinely different pricing behavior — one price-return, one total-return — and that the gap between them was the arbitrage. Empirical checks against each protocol's own official documentation and against real, live on-chain price history falsified that premise before any execution code was built on top of it: xStocks and bStocks are themselves dividend-reinvesting, rebase-adjusted tokens (confirmed via xStocks' own docs at docs.xstocks.fi and bStocks' own site), functionally total-return instruments, not price-return trackers. A live MSFT ex-dividend date and a full weekend "market closed" window were both checked against real BSC price data for bStocks vs. Ondo; neither showed any of the divergence the original thesis predicted. There was no real signal to detect.

What real, checkable divergence for the identical instrument, at every scale, was ordinary AMM microstructure: **the same tokenized stock, traded through more than one PancakeSwap V3 pool at a different fee tier, doesn't stay perfectly arbitraged against itself.** For MSFTB (bStocks' Microsoft token) on 2026-09-24, the 0.25%-fee pool and the 1%-fee pool were pricing the same token $3.56 apart (0.71%) at the same instant — a real, on-chain, verifiable gap, not a documentation claim. The same pools' hourly candles show intra-hour price swings up to 1.6% within a single hour, invisible to anything sampling once a day.

The catch, and the reason this isn't a free lunch: Binance's own Web3 Trading API (the aggregator this project already integrates with) auto-routes every quote to the best available price across pools — by design, it erases exactly this gap for anyone using it normally. Capturing it requires bypassing the aggregator for at least one leg of the trade and interacting with a specific pool contract directly, and even then the gap has to actually clear that pool's own swap fee, estimated slippage, and gas before it's a real edge — the same MSFTB gap, run through that math, turned out **not** to clear the cheaper-priced pool's own 1% fee. The signal is real; whether any given instance of it is tradeable is a computation, not an assumption, and the honest answer is sometimes no.

---

## 2. Target Users & Use Cases

| User | Use case |
|---|---|
| **Primary — the trader** | Wants exposure to genuine cross-pool mispricing between PancakeSwap V3 pools of the same tokenized stock, without personally watching every pool and fee tier or babysitting an agent that might misfire. |
| **Secondary — the judge/evaluator** | Needs to verify, in under four minutes, that the system does what it claims: detects a real cross-pool gap, distinguishes it from one that doesn't survive fees, slippage, and gas, and enforces its own safety rules — without reading the codebase. |
| **Tertiary — the builder reusing the pattern** | A developer wanting a reference implementation of an isolated LLM layer in front of a deterministic guardrail gate, where "the LLM only reads the request; code decides" is reusable outside tokenized equities entirely. |

Core use cases:
1. Detect a genuine cross-pool spread on a chosen underlying and, within pre-set guardrails, act on it. (Live on-chain arbitrage is disabled until two-leg execution exists — see §10.)
2. Give the agent an order in plain language on the dashboard (any language; the AI only reads the stock, side and dollar amount) and see how the guardrails and live data judge it.
3. Manually override or pause the agent at any time via the killswitch, with the change taking effect on the next evaluation, not the next page load.
4. Review a complete, timestamped audit trail for every decision the agent made — including every "no" — for accountability.

---

## 3. Core Thesis

**Product thesis:** Trust in an autonomous trading agent doesn't come from a good LLM — it comes from guardrails a user can *see* enforcing themselves in real time. The dashboard's job isn't to visualize a black box; it's to make the box transparent enough that "trust the agent" becomes "verify the agent," live, every time.

**Technical thesis:** The only defensible arbitrage signal in this asset class is a *cost-net* spread. A raw price diff between two pools of the identical tokenized stock is not a signal on its own — each pool's own swap fee, the trade's estimated slippage, and gas all have to be subtracted before what's left is real, and empirically that net figure is negative more often than the raw gap alone would suggest (the real MSFTB 0.25%/1% pair's 0.71% raw gap nets to roughly −0.7% once the cheap pool's own 1% fee is paid). Safety, meanwhile, has to live outside the LLM's own reasoning as deterministic, independently tested code, because an LLM cannot be trusted to enforce its own limits.

**Business thesis:** Tokenized equities are the wedge; the durable value is the transparency-and-guardrail layer itself. As more capital moves through AI-driven onchain execution, "provably safe autonomous execution" is a standalone need — this build proves the pattern on one vertical first.

---

## 4. The Reference Vertical

Basis ports a mechanism that already exists and already works in every mature AMM ecosystem: **keeper-driven cross-pool arbitrage.**

Any AMM that lets the same asset trade through more than one pool — different fee tiers, different DEXs, different routing paths — relies on independent actors (keepers, arbitrage bots) to notice when those pools drift apart and trade them back toward parity. That's not a gap in the design; it's the mechanism that keeps pool prices honest in the first place, the same role market makers play in a TradFi order book. Basis plays that keeper role for tokenized-equity pools specifically: it watches a token's known fee-tier pools, computes whether the gap between them survives each pool's own fee plus slippage and gas, and only acts on the ones that do. Instead of institutional capital, it runs on a small, guardrailed, self-funded wallet; instead of routing through an aggregator that would auto-erase the gap (Binance's own Web3 Trading API does exactly this), it interacts with the cheap pool directly for at least one leg of the trade.

This reference vertical matters for the same reason the original ETF/AP framing was supposed to: the hard part (defining what a genuinely tradeable spread means, and proving a given instance of it survives real costs) isn't invented for this hackathon — it's the same math every keeper bot and every AMM-aware market maker already runs, just applied to a newer asset class.

---

## 5. Research Summary — What Already Works, and Why

We looked at four adjacent domains before designing anything, specifically to avoid re-deriving patterns other people have already paid for in real incidents.

### a) DeFi arbitrage bot architecture
Comparing multiple independent implementations of DEX arbitrage bots shows a clear evolution: early designs split "price scanner" and "trade executor" into separate processes; later, more mature versions **collapsed them into a single integrated loop**, because the network round-trip between two separate processes meant opportunities were routinely gone before execution fired. The safety features that survived into production code were *reactive*, not designed up front:
- A circuit breaker that trips after a small number of consecutive feed failures, to stop the bot acting on stale prices from a silently-dead connection.
- A sanity bounds check on implied price, added after a corrupted liquidity value produced an absurd price and the bot almost acted on it.
- A minimum liquidity-depth check before sizing a trade.

**Principle taken:** detection and execution live in one process/loop for latency; every guardrail should map to a specific failure mode we can name, not a generic "add safety" checkbox.

### b) AMM cross-pool fee-tier fragmentation
This section originally described a TradFi-style total-return/price-return arbitrage between xStocks/bStocks and Ondo, ported from ETF NAV arbitrage. That thesis was tested empirically, not assumed, and didn't survive contact with real data — three separate checks, each against real sources, each negative:

- **Documentation check:** xStocks' own docs (docs.xstocks.fi/docs/dividends-and-stock-splits) and bStocks' own site (bstocks.finance) both describe a rebase mechanism that reinvests dividends into token balances — the same structural behavior the original thesis attributed only to Ondo. Neither is a price-return instrument.
- **Ex-dividend check:** MSFT's real 2026-08-20 ex-dividend date, checked against real bStocks and Ondo token prices at the time, showed no divergence — both moved together, in the same direction, by a similar magnitude, while only the real underlying stock actually dropped on the ex-div date.
- **Weekend-window check:** a full Friday-to-Monday window, checked the same way, showed both instruments moving continuously through the "market closed" period with no gap and no freeze at reopen.

What real divergence for the identical instrument *did* show up, checked the same way (real data, not documentation claims): the same tokenized stock traded through PancakeSwap V3's different fee-tier pools doesn't stay arbitraged against itself. MSFTB's 0.25% and 1% fee pools showed a same-instant $3.56 (0.71%) gap; the same pools' hourly candles showed intra-hour swings up to 1.6%. This is ordinary AMM fragmentation, not a domain-specific total-return effect, and it's a well-understood, well-documented phenomenon in DeFi generally — smart-order-routing aggregators (Binance's own Web3 Trading API among them) exist specifically to erase it for end users, which is also why capturing it requires bypassing that aggregator for at least one leg of the trade.

**Principle taken:** don't diff two pools' raw prices directly, and don't assume a raw gap is tradeable. Fee-adjust each pool's price for the side of the trade it's on (buying pays the pool's fee, selling nets less by it), then net that against estimated slippage and gas. The spread that's left over is the real, cost-net edge; a positive raw gap with a negative net edge is not a signal, it's a trap — confirmed directly on the real MSFTB pair, where the 1% pool's own fee alone exceeds the entire 0.71% gross gap.

### c) Guardrails for autonomous, LLM-driven execution
Every independent guardrail implementation we examined converges on the same structural rule, arrived at from different starting points: **the safety check must be a separate, deterministic layer outside the LLM's own reasoning — not a prompt instruction, a pure function or external proxy the LLM's output is forced through.** Recurring specific patterns:
- A pre-trade check function that is pure and side-effect-free: it returns a verdict and a bounded position size; the calling code still has to act on it. The check never executes a trade itself.
- Independent per-transaction and per-day hard spend limits, enforced structurally (not "please stay under $X" in the prompt).
- Mandatory dry-run/simulation before any live send, with a *structural* minimum-output floor — not a slippage tolerance the model is merely asked to respect.
- A dedicated, isolated session/agent wallet that is never the main treasury — this is also literally how Binance's own Agentic Wallet is built (isolated balance, rules set outside the AI's reach, enforced at the API level).
- An asymmetric failure mode on the guardrail layer itself: fail closed on budget/limit violations specifically, but fail open on unrelated bugs in the guardrail code — so the safety layer doesn't become a new single point of failure for the whole agent.

**Principle taken:** build the guardrail as testable code with its own unit tests, completely independent of whatever LLM is doing the natural-language interpretation.

### d) x402 self-funding
Real production dogfooding of x402 surfaces a specific, recurring failure: a payment settles on-chain but the destination service's verification step rejects the proof anyway, leaving the agent having paid without receiving the resource. Combined with the fact that payment challenges have a fixed expiry window (commonly ~10 minutes), the operational answer isn't "retry harder" — it's tracking receipts explicitly, treating a stuck payment as a distinguishable state from a rejected one, and falling back to a free/cached data source rather than looping into your own budget cap.

**Principle taken:** if the agent ever pays for its own data, that operating spend must be budgeted and audited completely separately from the trading capital, so a failure in one can't cascade into the other.

**Decision: evaluated and rejected.** x402 self-funding would only be worth its failure modes if it bought data Basis needs. The x402 Bazaar listings reviewed had no equity/RWA data merchants, so there was nothing for Basis to pay for. Basis therefore has **no operating-budget wallet and makes no x402 payments**: its market data comes from on-chain pool reads (BSC RPC) and the Binance Web3 API, neither paid per call from a wallet. The separation principle above stays the rule should paid data ever be added.

### The convergent design principle
Across all four: **separate the thing that decides from the thing that holds money, at every layer.** LLM intent-parsing is separate from the trade-execution path. The one trading wallet's key is read only by the local signer; the public deployment never has it. And a raw price difference is treated as a hypothesis to disprove against a domain-adjusted baseline, not a signal to act on directly.

---

## 6. End-to-End User Experience

1. **Landing = the dashboard itself.** No marketing page. The persistent header shows system state (API/RPC health, wallet balances, killswitch position) before any scrolling.
2. **Judge/trader sees a live Pool Spread Monitor** — gross cross-pool gap vs. net edge after costs per underlying, with each pool's fee tier visible so it's obvious when a raw gap is being correctly rejected because it doesn't clear costs.
3. **An opportunity clears threshold** — only when the net edge after both pools' fees, slippage, and gas is positive, and only after enough price history has built up since server start to sanity-check both pools — the Advisory Feed prints a plain-English proposal, generated from a fixed template. Every evaluation that doesn't clear is still recorded in the Audit Ledger as a detection decision.
4. **The Guardrail Gate evaluates it live**, visibly ticking through price sanity on both pools, market status, the Binance reference price, per-trade cap, daily cap, and dry-run min-output checks. The badge says what happened: **BLOCKED**, **GUARDRAILS PASSED · NOT SENT** (with why: no positive edge, simulation, dry-run, live refused), or **APPROVED · SENT** only if something was actually sent. A check with no data is shown as WARMING UP or PENDING, never as a pass.
5. **If approved**, dry-run mode runs the execution path up to the point of sending: pre-send re-read of both pools, ERC-20 allowance check, QuoterV2 simulation, and the dry-run floor on the simulated output. Approval, signing, and sending straight to the PancakeSwap V3 SwapRouter are built and tested too, but no mode reaches them: **live on-chain arbitrage is disabled until two-leg execution exists**. Only the buy leg is built, and a single leg alone doesn't capture the spread, so live mode refuses every order before any approval or send and logs the refusal.
6. **Any time**, the trader can flip the Master Killswitch between Simulation → Dry-Run → Live; the scheduler picks up the change on its next tick. On the public demo Live is refused, and any other mode returns to simulation 5 minutes after the last change.

---

## 7. System Architecture

As built and running (2026-09-26). Every box is a module under `lib/`.

```
┌──────────────────────────────────────────────────────────────────┐
│  DATA LAYER  (scheduler: one integrated loop, every 30 s)         │
│  BSC RPC → PancakeSwap V3 slot0/liquidity for MSFTB's 0.25% and   │
│            1% pools; QuoterV2 gas for both legs (live gas cost)   │
│  Binance Trading API  GET /api/v1/dex/aggregator/quote            │
│            → reference price for the same buy, same size          │
│  Binance RWA Data     GET /api/v1/dex/market/rwa/underlying-market│
│            → the underlying stock's market status                 │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  BASIS MODEL  (pure functions, no LLM)                            │
│  buy price  = cheap pool × (1 + its fee)                          │
│  sell price = dear pool  × (1 − its fee)                          │
│  net edge   = (sell − buy) / buy − slippage − gas / size          │
│  Price sanity vs. the last 10 readings; liquidity depth           │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼ an order only if net edge > 0
┌──────────────────────────────────────────────────────────────────┐
│  LLM LAYER  (Groq, isolated)                                      │
│  Only for typed instructions: sentence → {ticker, side, sizeUsd}, │
│  schema-validated. Never a price, a pool or a transaction.        │
│  Proposal text comes from fixed templates, not the LLM.           │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  GUARDRAIL GATE  (pure check(), independent of the LLM)           │
│  sanityAndLiquidity · marketStatus · referencePrice (≤ 2%)        │
│  perTradeCap $500 · dailyCap $2,000 · dryRunFloor 98%             │
│  + before any send: spreadFreshness, slippageTolerance            │
│  Fails CLOSED on any failed check or internal error               │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼ killswitch: simulation / dry-run / live
┌──────────────────────────────────────────────────────────────────┐
│  EXECUTION  (one trading wallet, key held locally)                │
│  simulation: checks only.  dry-run: re-read pools, allowance,     │
│  QuoterV2, Binance POST /api/v1/dex/pre-transaction/simulate.     │
│  live: arbitrage REFUSED (only the buy leg is built).             │
│  Execution test (local only, $5 cap): simulate → local signing →  │
│  POST /api/v1/dex/pre-transaction/broadcast-transaction (MEV      │
│  protection) → receipt. Proven on mainnet 2026-09-25.             │
│  Every decision → the audit ledger (repeated "no"s compacted).    │
└──────────────────────────────────────────────────────────────────┘
```

**What runs where.** On the public deployed site (`PUBLIC_READ_ONLY`, no key) the Binance calls are `aggregator/quote` and `rwa/underlying-market`, on every tick and every typed instruction. The Transaction API endpoints (`pre-transaction/simulate`, `broadcast-transaction`) only run in dry-run when an order has a positive net edge (none has so far, so the deployed site has never called them) and in the local execution test, where they ran for the four mainnet transactions of 2026-09-25. The read-only **cross-issuer recorder** (`lib/issuers/`; Monitor only: Basis doesn't trade across issuers) adds `aggregator/quote` buy quotes for xStocks MSFTx and Ondo MSFTon every 30 s, and one `rwa/price` plus a sell quote per token every 5 min (about 4.8 calls a minute), and serves its per-share readings from memory at `/api/issuers`. Token addresses were confirmed from each issuer's own data, the chain, and Binance's RWA API.

There is no second, operating-budget wallet: x402 self-funding was evaluated and rejected (section 5d).

**Wallet** (the load-bearing safety boundary is who can use the key, not a second wallet):

| Wallet | Funds what | Failure blast radius |
|---|---|---|
| Trading wallet (self-funded BSC account, key held locally) | Swaps and their gas. Today only the $5-capped execution test; live arbitrage is disabled | Bounded by the per-trade and per-day caps and the execution test's $5 hard cap. The public deployment runs `PUBLIC_READ_ONLY` and never reads the key |

**Deployment:** Next.js (TS) app, API routes as the server boundary — Groq and Binance Web3 API keys never reach the client. One deployed URL on Railway (Singapore), public and read-only. BSC mainnet; the only live amounts so far are the $5 execution test, run locally.

---

## 8. Recommended Stack

What the build actually uses:

- **Next.js 15 (TypeScript)** — single deployable app with one URL; API routes are the server boundary.
- **viem** for BSC reads (pool state, QuoterV2, balances, gas) and for local signing in the execution test.
- **Binance Web3 API** — Trading API (`aggregator/quote`, the reference price), Market API / RWA Data (`rwa/underlying-market`, market status), Transaction API (`pre-transaction/simulate`, `pre-transaction/broadcast-transaction` with MEV protection). Only bStocks MSFTB; no swaps through the aggregator.
- **Groq (free tier, `openai/gpt-oss-120b`)** — reads a typed instruction into ticker, side and dollar amount; nothing else. Kept structurally incapable of touching the wallet or setting a price.
- **Railway** (Singapore, Hobby plan) — the public, read-only deployment.

Evaluated and not used: **Agentic Wallet / Wallet Skills** (Basis signs locally with its own key), **BNB Agent Studio**, **x402** (section 5d).

---

## 9. Design & UI

### 9.1 System Overview (replaces a landing page)
A persistent header across the top of the single dashboard, always visible:
- **One-liner:** "Cross-pool gaps, counted only after every cost."
- **Live status:** the Binance Web3 API's last call and its latency; the BSC RPC's and Groq's last real call (ok or failing, and how long ago; grey "no calls yet" before the first one); the underlying market status from Binance.
- **Wallet balances:** a status chip with the trading wallet's live on-chain BNB, USDT and MSFTB balances, rounded for reading (e.g. 0.0029 BNB · 4.975 USDT). (An earlier Trading Capital / Operating Budget split was never connected to real balances and was removed.)
- **Master killswitch:** a single, unmissable control cycling Simulation → Dry-Run → Live.

### 9.2 Core Dashboard Layout
The layout itself has to argue the thesis: decision and safety are visibly separate systems, not one opaque pipeline. Top to bottom (one column on phones):
- **Sidebar:** links to the page's real panels (Instruction, Spread monitor, Cost breakdown, Guardrail gate, Audit ledger, and How it works while the Start here panel is shown). A left rail on wide screens; a tab strip on phones.
- **Header:** name and one-liner, the killswitch as a segmented control (Live shows a lock and is disabled on the public demo), a "Public demo · read-only" badge and note, and a ribbon of status chips.
- **Instruction box:** type an order in plain language (with clickable examples, including a sell that is refused); the result is shown in plain language with the raw reply expandable. The AI only reads the sentence into ticker, side and size; the decision comes from the guardrails and live data.
- **Pool Spread Monitor ("the math"):** a metric strip (both pools' prices, the Binance quote, the net edge) and a dual-line chart, gross cross-pool gap vs. net edge after fees, slippage, and gas, on one axis with a labeled zero (break-even) line and the below-zero region shaded. Each point is one live evaluation; the seeded historical fixture is shown only when no live evaluation exists, and is labeled as such.
- **Cost breakdown** (beside the monitor): the latest evaluation's gross gap, each pool's fee, slippage and gas (% and $ on the order), the total, and the net edge, computed on the server with the Basis Model's own functions, so it always equals the monitor's net edge.
- **Issuer monitor** (full width, under the monitor): Microsoft's token from bStocks and Ondo, compared **per share** (price ÷ shares multiplier) from Binance quotes at the same size, from the read-only cross-issuer recorder. Only the latest reading's numbers are shown; a token without a valid quote shows the reason and when its last valid quote was, never a stale number. It shows the gap and whether buying one issuer and selling the other would clear the quotes' fees, price impact and gas. Labelled "Monitor only: Basis doesn't trade across issuers"; it says why xStocks isn't included.
- **Advisory Feed ("the brain")** (under the cost breakdown): lines generated from fixed templates filled with real data (the largest gap in the last hour, Binance market-status changes, and any opportunity that clears the threshold). No AI writes them.
- **Guardrail Gate ("the shield")** and **Audit Ledger ("the log")**, side by side. Each guardrail row says what the check does, its limit (from config) and what it measured on the order; the badge reads **BLOCKED**, **GUARDRAILS PASSED · NOT SENT** (neutral, with the reason), or **APPROVED · SENT** only when something was actually sent. The ledger is a timestamped feed (detection → guardrail check → outcome, with transaction hashes for anything sent), filterable (All / Orders / Detections), with a client-side CSV export of the rows shown.

### 9.3 Visual style
- **A dark terminal look:** near-black canvas with slate panels one step up, **1px hairline borders instead of shadows**, 4–6 px corner radius, compact uppercase panel headers, dense but legible data. Taken as a visual language from two design references; none of their example content, numbers or claims is used (`test/redesign-rules.test.ts` keeps them out).
- **Type:** Inter for UI text; JetBrains Mono with tabular, slashed-zero numerals for every number, hash and the ledger, so figures don't jitter as they update. Both self-hosted with next/font (size-adjusted fallbacks, no layout shift).
- **Palette: BNB Chain's brand colours** (bnbchain.org/en/brand-guidelines): near-black `#0B0E11` canvas, white `#FFFFFF` headings, yellow `#F0B90B` accent, plus slate surfaces (`#0E131F`, `#121824`, `#1A2234`) and text greys (`#CBD5E1`, `#94A3B8`). Colours only: no BNB Chain logo (its use needs BNB Chain's approval and must not imply endorsement), and no "Official" or "Partner" wording; the footer says "Built on BNB Chain" in plain text. All colours are defined once, in `components/theme.ts`, and injected as CSS variables.
- **Colour meanings stay unambiguous.** Yellow is decoration and primary action only (the Send button, the active killswitch mode, links, step numbers) and never signals a state. Pass / approved-and-sent is green (`#0ECB81`), block / fail is red (`#FF5A6E`). "Guardrails passed · not sent" is neutral white, never green: passing the checks is not a trade. Pending / warming up / no call yet is neutral grey (`#A7AEB8`) with a dashed outline and an explicit label. Text on yellow, green or red is near-black, never white. Every text/background pair passes WCAG AA (4.5:1); the pairs and ratios are tested (`test/theme.test.ts`).
- **Chart on dark:** gross gap as a dashed yellow line, net edge as a thicker solid white line, a dashed grey zero line labelled "0 = break-even", and a dark-red band labelled "below zero: doesn't clear costs".
- **Phones and motion:** mobile-first, one column under 768 px, 44 px touch targets on touch screens; the Start here panel collapses to one sentence and "More". No pulsing or decorative animation, and `prefers-reduced-motion` turns off smooth scrolling and any transition. The chart library loads after first paint into a fixed-height box.
- **Avoid:** made-up telemetry, version numbers, "institutional" framing, avatars, and any control that changes shared state for other visitors.

---

## 10. MVP Scope

**Real, working:**
- Live on-chain pool reads (slot0/liquidity) for every registered PancakeSwap V3 pool of the confirmed underlying(s), via a BSC RPC endpoint
- The fee-adjusted spread math, with unit tests proving it correctly distinguishes a genuinely tradeable net edge from a raw gap that doesn't clear real costs — validated against real MSFTB pool data, not synthetic numbers; gas priced live for both legs (QuoterV2 gas × live gas price × on-chain BNB price × a safety multiplier)
- The execution path — pre-send re-read, ERC-20 allowance and approval, QuoterV2 simulation, signing, and sending to the PancakeSwap V3 SwapRouter — built and tested with a mocked wallet. Dry-run mode runs it live up to, but not including, sending. **Live on-chain arbitrage is disabled until two-leg execution exists**: live mode refuses every order before any approval or send
- The guardrail gate as independent, tested code (price sanity with a warm-up period, spend caps, dry-run floor, on-chain slippage tolerance below the edge, fail-closed behavior)
- Audit ledger of every decision (detection decisions, guardrail blocks, refusals, dry-runs)

**Mocked for demo:**
- Pool registry — hardcoded to the specific fee-tier pools independently verified this way (MSFTB's 0.25%/1% pair today) rather than a general pool-discovery scanner

---

## 11. Build Steps

What was built, in order (the git history has each step). Phases 0–1 were first written for the original cross-protocol thesis and rewritten for cross-pool detection once that thesis was falsified (§5b).

| Phase | Delivered |
|---|---|
| 0. Setup | Repo scaffolding, Next.js app shell, env var contracts |
| 1. Data + Basis Model | Live PancakeSwap V3 pool reads for MSFTB's two fee-tier pools; fee-adjusted net-edge math with live gas, tested against real MSFTB readings |
| 2. Guardrail Gate | Pure `check()`, unit-tested independent of any LLM: price sanity with warm-up, liquidity, market status, Binance reference, spend caps, dry-run floor |
| 3. Execution Wiring | Direct-pool swap path (allowance, QuoterV2, SwapRouter), local signing, Binance Transaction API simulate + MEV-protected broadcast, audit ledger; live arbitrage refused until two-leg execution exists |
| 4. LLM Layer | Groq intent parsing (the only AI use); proposal text from fixed templates |
| 5. Orchestration + Dashboard | 30 s scheduler, instruction route, killswitch; bento dashboard: Pool Spread Monitor, instruction box, Advisory Feed, Guardrail Gate, Audit Ledger, status chips |
| 6. Live proof + hardening | $5 MSFTB round trip on mainnet (2026-09-25); `X-OC-RECV-WINDOW`, timeouts, per-call Binance log; public read-only mode with rate limits |
| 7. Deployment | Railway (Singapore), `PUBLIC_READ_ONLY`; Start here panel; plain-language guide; public-safe errors and real service health |
| 8. Submission | Demo video (≤4 min), DevEx report (submitted through its own form), repo freeze before the deadline |

---

## 12. Technical Correctness Rules (Non-Negotiable)

1. The guardrail `check()` must be pure and side-effect-free, unit-tested completely independent of any LLM call.
2. LLM output must always be a schema-validated structured object. It is never permitted to construct or sign a transaction directly.
3. Every live execution is preceded by a dry-run/simulation call; the minimum-output floor is enforced in code, not merely requested of the model.
4. Spend limits (per-trade, per-day) are checked **before** any call goes out, not after. The gate fails closed on a limit violation.
5. There is one trading wallet. Its key is read only by the local signer; the public deployment runs `PUBLIC_READ_ONLY` and never reads it. There is no operating-budget wallet (x402 self-funding was evaluated and rejected, section 5d); if paid data is ever added, its spend must be kept financially separate from the trading wallet.
6. The fee-adjusted spread computation exists as its own tested module. A raw, unadjusted cross-pool price diff must never be used directly as an execution signal.
7. Every price feed passes a sanity-bounds check and a liquidity-depth check before being used in a spread calculation.
8. **Every** decision is recorded in the audit ledger — approved, blocked, failed, and every "no" — not only executed trades. Memory is bounded, so what's kept is exact: orders (every guardrail run), warm-up readings, skipped ticks and execution tests keep full detail. Consecutive "no opportunity" detections for the same ticker and mode are compacted at write time into one run entry (count, first and last time, net-edge and gross-gap ranges, how many used fallback gas or had no Binance reference, and the latest full reading). The last 120 readings per ticker stay individual for the chart, and running totals stay exact. A hard cap of 5,000 stored entries drops the oldest only under sustained abuse of the rate-limited instruction route, and counts what it dropped. Nothing is written to disk on the deployed site: a restart starts a new ledger.
9. The killswitch state (Simulation / Dry-Run / Live) is checked on every execution attempt at the infrastructure layer, never cached at app load.
10. Secrets (Groq key, Binance Web3 API key, wallet credentials) never reach the client and are never committed to the repo.

---

## 13. Repository Expectations

- **Public repo**, part of the hackathon's mandatory project submission (see §16).
- **README** covering: one-liner, what runs where, setup steps, documented (not filled-in) required env vars, how a judge runs it — including how to switch between Dry-Run and Live — and the demo video link.
- **Folder structure (as built):**
  ```
  /app                  — dashboard page + API routes (status, opportunities,
                          instruction, killswitch, ledger, health, execution-test)
  /components           — dashboard panels + pure display helpers (tested)
  /lib/data             — pool reads, gas estimate, Binance clients (quote,
                          RWA market status, Transaction API), call log
  /lib/basis-model      — fee-adjusted prices, net-edge math, sanity checks
  /lib/guardrails       — the pure check() gate (+ tests)
  /lib/execution        — pipeline, local signer, execution test, audit
                          ledger, wallet balances
  /lib/llm              — Groq client, intent parser, template narrator
  /lib/orchestration    — scheduler, agent loop, instructions, killswitch
  /lib/config, /lib/errors — deployment mode, rate limits, service health,
                          public-safe errors
  /docs                 — PRD, how-to-use, runbook, config rationale,
                          devex-log (raw material for the DevEx report)
  /test                 — cross-cutting tests (read-only mode, docs, UI text)
  ```
  Leftovers from the rejected cross-protocol thesis are still in the tree and unused: `lib/data/dividend-calendar.ts`, `lib/data/token-addresses.ts`, and `fetchQuote`/`fetchQuotes` in `lib/data/quotes.ts`. `lib/basis-model/nav-equivalent.ts` and `lib/execution/agentic-wallet.ts` keep their early names; they hold the fee adjustment and the local signer.
- A `.env.example` with every required variable name and no real values.
- Unit tests specifically covering the basis model and guardrail gate are non-optional — these are the two modules the entire trust argument rests on.
- Commit history reflecting work done inside the Sep 16 – Oct 11 window, since everything submitted must be built inside it.
- An open-source license file.

---

## 14. Judging Criteria Alignment

| Criterion | Weight | How this PRD addresses it |
|---|---|---|
| Technical implementation | 30% | Fee-adjusted cross-pool spread model with live gas + independent guardrail gate (price sanity with warm-up, market status, Binance reference price, spend caps, dry-run floor, slippage tolerance below the edge, pre-send freshness) + Binance Web3 API: Trading API quote and RWA market status on every tick (deployed site), Transaction API simulate + MEV-protected broadcast proven in the local $5 mainnet test |
| Creativity & originality | 25% | Fee-tier fragmentation between pools of the same tokenized stock — the gap Binance's own aggregator erases for normal users — with the aggregator's quote reused as an outside reference for pool prices |
| Developer Experience Report | 25% | Built from `docs/devex-log.md`: raw facts of every Binance Web3 API interaction (DNS, docs access, verbatim responses, latency) |
| Product quality & UX | 20% | Plain-language instruction box (Groq only reads the sentence; any language); template-generated proposals; visible, explainable guardrail decisions that say "not sent" and why; plain-language guide and Start here panel |

Stack awards: not currently targeted. Basis signs locally with its own key rather than through Agentic Wallet/Wallet Skills, and doesn't use BNB Agent Studio or x402. Both are optional under the rules.

---

## 15. Key Risk & Answer

**Likely objection:** "This is still just an arbitrage bot — how is the safety framing more than marketing?"

**Answer:** Demonstrate it live. Show a real gap between two pools of the same tokenized stock — the gross line a naive price-diff bot would trade on. Show the net edge after both pools' fees, slippage, and live gas sitting below zero, and the detector declining it. Then send a deliberately oversized order and show the guardrail gate blocking it, with every check and its reason logged and auditable rather than asserted. The system also refuses live execution until both legs of the arbitrage exist: it won't trade half an arbitrage.

---

## 16. Acceptance Criteria — Definition of Done

**Functional**
Ticked items were verified on the deployed site or on mainnet, as noted.

- [x] Live pool prices render for each independently-verified fee-tier pool of the confirmed underlying(s) within the dashboard at an acceptable refresh latency. (Deployed site: a new reading every 30 s.)
- [x] The fee-adjusted spread calculation demonstrably identifies at least one documented case where a real raw cross-pool gap does not clear trading costs (fees, slippage, gas) — a case a naive raw-diff bot would have flagged as a false signal. (Every live evaluation so far: the two pools' fees alone are 1.25%.)
- [x] The guardrail gate visibly blocks at least one deliberately-triggered violation (e.g., an oversized order) live, not just in a unit test. (Deployed site: "Buy $1000 of MSFT" → BLOCKED by perTradeCap.)
- [x] The execution path (pre-send re-read → allowance/approval → QuoterV2 simulation → Binance Transaction API simulate → local sign → Binance MEV-protected broadcast → receipt) is built and covered by tests.
- [x] **The live send path is proven on BSC mainnet.** On 2026-09-25 the manual execution test (`POST /api/execution-test`, killswitch `live`, `confirm: true`, $5 hard cap) ran a $5 MSFTB round trip on the 0.25% pool, ledger entry `ledger_1790342672442_26`, outcome `completed`. Four transactions, all mined with status success at 0.05 gwei, each simulated by Binance first and broadcast through Binance with `enableMevProtection: true`:
  - USDT approve `0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7` (block 123956296)
  - buy swap `0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe` (block 123956355)
  - MSFTB approve `0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493` (block 123956388)
  - sell swap `0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff` (block 123956404)

  Result: 5 USDT → 0.009987 MSFTB → 4.975031 USDT, 497,423 gas, 0.00002487 BNB in fees. Full record and on-chain verification in `docs/devex-log.md`.
- [x] **Live on-chain arbitrage stays disabled until two-leg execution exists.** Live mode refuses every arbitrage order before any approval or send (`two_leg_execution_not_implemented`), and that refusal is itself tested and logged. The execution test is not arbitrage: a separate route, never reachable from the scheduler or the arbitrage path, ledgered as its own kind (`execution_test`). The demo shows real detection declining a real gap that doesn't clear costs, and a deliberate guardrail block — neither staged.
- [x] The audit ledger shows the complete chain for every decision: detection (pool prices, gross gap, net edge, gas and its source, Binance reference, underlying market status) → guardrail check → outcome. Arbitrage entries have no TxID while live arbitrage is disabled; the execution test's entry carries its four.
- [x] The killswitch demonstrably changes agent behavior across all three states: Simulation (gates only), Dry-Run (full path short of sending), Live (refused as two-leg execution not implemented). (Tests for all three; on the deployed site Live is refused with 403, and dry-run's automatic return to simulation after 5 minutes was verified on 2026-09-26.)

**Submission**

Two things are mandatory: the project and the Developer Experience Report ("Both are mandatory. Miss either one and you don't get scored." — blog).

- [x] **The project is built on the Binance Web3 API.** The hackathon page defines it as "A working project built on one or more Binance Web3 API modules, and optionally Agentic Wallet or Wallet Skills." Basis uses three modules:
  - the **Trading API**: `GET /api/v1/dex/aggregator/quote` on every scheduler tick and for every typed instruction, as the `referencePrice` guardrail's reference;
  - the **Market API, RWA Data** module: `GET /api/v1/dex/market/rwa/underlying-market` on every scheduler tick and for every typed instruction, feeding the `marketStatus` guardrail;
  - the **Transaction API**: `pre-transaction/simulate` on our own `exactInputSingle` calldata before every send (and in dry-run, for an order with a positive net edge), and `pre-transaction/broadcast-transaction` with `enableMevProtection: true` as the only broadcast (no public-RPC fallback). So far these ran only in the local execution test: four simulate and four broadcast calls, the mainnet round trip above.
  - On the deployed site the calls are `aggregator/quote` and `rwa/underlying-market` only: it is read-only, and no order has had a positive net edge, so it has never reached simulate. Its `/api/status` lists every recent call.
- [x] **A public repo** with README instructions a judge can follow standalone, with no undocumented setup steps. (github.com/blaxko/basis, MIT.)
- [x] **A deployed link, or instructions a judge can follow.** (https://basis-production-c229.up.railway.app, read-only.)
- [ ] **A demo video, four minutes or less.** Recorded; the link goes in with `npm run set-demo-video <url>` (README, how-to-use and the Start here panel). The submission form marks the video URL as required, although the page calls it optional.
- [ ] **The Developer Experience Report:** specific, actionable, honest; 25% of the score; "Perfunctory or AI-generated reports are not accepted." Submitted through its own form; raw material is collected in `docs/devex-log.md`.
- [x] **Build requirement:** "At least one of bStocks, Ondo or xStocks has to be central to what you submit." Basis uses bStocks MSFTB on PancakeSwap V3.

**Hackathon rules, as recorded.** Sources: the hackathon page (bnbchain.org/en/hackathons/tokenized-stocks, "Tracks" tab, checked 2026-09-25) and the blog post (bnbchain.org/en/blog/bnb-hack-tokenized-stocks-edition-with-binance-web3-wallet, checked 2026-09-24).

- **Correction history.** An early version of this section said the Binance Web3 API and BNB Agent Studio were mandatory integrations. The next version said neither was, based on the blog alone. The hackathon page settles it: the Web3 API is required (the project must be built on one or more of its modules). BNB Agent Studio is not ("Optional, tied to a special prize").
- **Agentic Wallet / Wallet Skills:** "Optional, heavily weighted in scoring and tied to a special prize." Basis doesn't use it; it signs locally with its own key.
- **Execution** (blog): "BSC mainnet only. Dry-run with the Transaction API while you build, then demo with small live amounts. Teams fund their own wallets." Spot only; perps are out. Met: Transaction API dry-runs throughout, then the $5 live round trip on 2026-09-25 from a self-funded wallet.
- **Scoring** (page): technical implementation 30% ("Does it run, and how deep does the integration go? Modules used, error handling, how it holds up."), creativity 25%, Developer Experience Report 25%, product quality/UX 20%.
- **Tie-break** (blog): "Tie-breaks go on depth of W3W API usage first, then the quality of your feedback report." Not mentioned on the page.
- **Dates** (page, UTC): submissions lock Sun 11 Oct, 12:00; judging 12–23 Oct. "Your repo, demo and deployed link must stay accessible through judging."
