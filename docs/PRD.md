# Basis — Product Requirements Document

**One-liner:** Trading the real spread, not the total-return noise.
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
| **Primary — the trader** | Wants exposure to genuine cross-protocol mispricing between xStocks/bStocks and Ondo representations of the same underlying, without personally tracking dividend/ex-div calendars or babysitting an agent that might misfire. |
| **Secondary — the judge/evaluator** | Needs to verify, in under four minutes, that the system does what it claims: detects a real spread, distinguishes it from dividend drift, and enforces its own safety rules — without reading the codebase. |
| **Tertiary — the builder reusing the pattern** | A developer wanting a reference implementation of Wallet Skills + Agent Studio + an isolated LLM layer, where "isolate the LLM from execution" is reusable outside tokenized equities entirely. |

Core use cases:
1. Detect and, within pre-set guardrails, execute a genuine cross-protocol spread on a chosen underlying.
2. Query the agent conversationally (via the dashboard or directly through Wallet Skills in Claude/ChatGPT) for current status, rationale, and open positions.
3. Manually override or pause the agent at any time via the killswitch, with the change taking effect on the next execution attempt, not the next page load.
4. Review a complete, timestamped audit trail for every decision the agent made — approved, blocked, or executed — for accountability.

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

**Principle taken:** the agent's *own* operating spend (data calls, x402-metered lookups) is budgeted and audited completely separately from the *trading* capital it moves through Agentic Wallet. A failure in one must not cascade into the other.

### The convergent design principle
Across all four: **separate the thing that decides from the thing that holds money, at every layer.** LLM intent-parsing is separate from the trade-execution path. Trading capital is separate from the agent's own x402 operating budget. And a raw price difference is treated as a hypothesis to disprove against a domain-adjusted baseline, not a signal to act on directly.

---

## 6. End-to-End User Experience

1. **Landing = the dashboard itself.** No marketing page. The persistent header shows system state (API/RPC health, wallet balances, killswitch position) before any scrolling.
2. **Judge/trader sees a live Pool Spread Monitor** — gross cross-pool gap vs. net edge after costs per underlying, with each pool's fee tier visible so it's obvious when a raw gap is being correctly rejected because it doesn't clear costs.
3. **An opportunity clears threshold** → the LLM Advisory Feed prints a plain-English proposal ("MSFT: 0.7% raw cross-pool spread, 1% fee pool cheap, proposed size $200").
4. **The Guardrail Gate evaluates it live**, visibly ticking through per-trade cap, daily cap, and dry-run min-output checks, resolving to a bold **APPROVED** or **BLOCKED** badge.
5. **If approved**, execution fires through Agentic Wallet; a new row lands in the Audit Ledger showing the full chain: data fetch → guardrail check → transaction ID → (if applicable) x402 receipt for the data call that fed the decision.
6. **Any time**, the trader can flip the Master Killswitch between Simulation → Dry-Run → Live, and can also just talk to the agent directly through Wallet Skills from their own Claude/ChatGPT client — the dashboard and the conversational surface are two views onto the same guardrailed core, not two separate products.

---

## 7. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA LAYER (single integrated loop, not split processes)       │
│  Binance Web3 API → live quotes: xStocks/bStocks (price-return)  │
│                      + Ondo (total-return)                      │
│  Dividend calendar (hardcoded for MVP set of underlyings)        │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  BASIS MODEL (pure function, unit-testable, no LLM involved)     │
│  1. NAV-equivalent for Ondo leg = price − accrued dividend        │
│  2. adjusted_spread = (NAV-equiv − price-return price) / price   │
│  3. Sanity bounds check vs. last N ticks                         │
│  4. Liquidity/depth check before sizing                          │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼ only if threshold cleared
┌─────────────────────────────────────────────────────────────────┐
│  LLM LAYER (Groq, isolated, advisory only)                        │
│  Structured opportunity → plain-English proposal.                │
│  Free-text user instruction → same structured schema.             │
│  Output is ALWAYS a validated structured object — never a signed  │
│  transaction, never a direct wallet call.                        │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  GUARDRAIL GATE (pure check(), independent of the LLM)           │
│  Per-trade cap · Daily hard cap · Dry-run min-output floor        │
│  Fails CLOSED on limit violations; fails to human review          │
│  (never to silent execution) on unrelated errors                 │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼ only if approved
┌─────────────────────────────────────────────────────────────────┐
│  EXECUTION — Agentic Wallet / Wallet Skills                       │
│  Isolated TRADING CAPITAL wallet. Executes, returns order ID,     │
│  writes to the audit ledger.                                     │
└─────────────────────────────────────────────────────────────────┘

     (running alongside, financially isolated from the above)
┌─────────────────────────────────────────────────────────────────┐
│  AGENT IDENTITY & SELF-FUNDING — BNB Agent Studio + x402           │
│  Separate, small OPERATING BUDGET wallet — pays for its own data/│
│  compute calls only. Tracks receipt IDs; on a failed/orphaned     │
│  payment, falls back to cached data rather than retry-looping.   │
└─────────────────────────────────────────────────────────────────┘
```

**Wallet separation matrix** (the load-bearing safety boundary):

| Wallet | Funds what | Failure blast radius |
|---|---|---|
| Trading Capital (Agentic Wallet) | Live swaps on detected spreads | Bounded by per-trade/per-day caps; cannot be drained by an x402/data-layer failure |
| Operating Budget (x402 / Agent Studio) | The agent's own paid data/compute calls | Bounded independently; a runaway loop here cannot touch trading capital |

**Deployment:** Next.js (TS) app, API routes as the server boundary — Groq and Binance Web3 API keys never reach the client. One deployed URL. BSC mainnet, dry-run via Transaction API during development, small live amounts for the demo.

---

## 8. Recommended Stack

- **Next.js (TypeScript)** — single deployable app with one URL, matching the hackathon's "judges need to run it" requirement.
- **viem** for BSC calls.
- **Binance Web3 API** — aggregated market data, quotes, swaps, dry-run Transaction API across all three protocols.
- **Wallet Skills** — natural-language execution surface, also usable directly from Claude/ChatGPT/Copilot for the "talk to your agent" demo path.
- **BNB Agent Studio + x402** — agent identity and self-funded data calls.
- **Groq (free tier)** — isolated LLM layer for intent parsing and English-language trade explanations. Chosen because the task (structured extraction, not deep reasoning) fits comfortably within Groq's free rate limits, and its low latency keeps a live demo feeling responsive. Kept structurally incapable of touching the wallet directly.

---

## 9. Design & UI

### 9.1 System Overview (replaces a landing page)
A persistent header across the top of the single dashboard, always visible:
- **One-liner:** "Basis: Trading the real spread, not the total-return noise."
- **Live status:** Binance Web3 API latency, BSC RPC status, Groq API uptime.
- **Wallet balances:** a clear visual split — Trading Capital vs. Operating Budget — so the wallet-separation thesis is visible before a judge reads a single line of copy.
- **Master killswitch:** a single, unmissable control cycling Simulation → Dry-Run → Live.

### 9.2 Core Dashboard Layout
The layout itself has to argue the thesis: decision and safety are visibly separate systems, not one opaque pipeline.
- **Pool Spread Monitor ("the math"):** dual-line chart, gross cross-pool gap vs. net edge after fees, slippage, and gas, per pool pair, on one axis with a labeled zero (break-even) line and the below-zero region shaded, so a real gap that fails to clear costs is visibly flagged, not hidden. Each point is one live evaluation recorded in the audit ledger; the seeded historical fixture is shown only when no live evaluation exists, and is labeled as such.
- **LLM Advisory Feed ("the brain"):** a scrolling terminal of plain-English proposals generated by Groq from the Basis Model's structured output — advisory only, visually distinct from anything that touches the wallet.
- **Guardrail Gate ("the shield"):** a real-time checklist — per-trade cap, daily hard cap, dry-run min-output — each with live state, resolving to bold **APPROVED**/**BLOCKED** badges.
- **Audit Ledger ("the log"):** a sequential, timestamped feed: Data Fetch → Guardrail Check → TxID (Agentic Wallet) → x402 Receipt Log.

### 9.3 Visual style
- **Bento UI** for structure — the system's real architecture is a set of distinct, isolated components (data layer, basis model, LLM layer, guardrail gate), so a strict grid that compartmentalizes each into its own card keeps a data-dense, multi-variable system legible instead of overwhelming.
- **Neo-brutalism** for aesthetics — high contrast, stark borders, bold typography. This is the visual argument for the product's thesis: stripped of marketing gloss, the raw execution logic is the product. Hard black borders around APPROVED/BLOCKED states signal a developer tool, not a consumer app.
- **A touch of cyberpunk, contained to the logs** — monospace, glowing-green-on-black terminal styling for the LLM Advisory Feed and Audit Ledger specifically, reinforcing "autonomous agent" without letting it spread into the data-legibility-critical charts.
- **Avoid:** Editorial Design and Glassmorphism — both prioritize typographic warmth or visual softness over the real-time legibility an arbitrage dashboard actually needs.

---

## 10. MVP Scope

**Real, working:**
- Live quote pulling across 3–5 underlyings via Binance Web3 API
- The fee-adjusted spread math, with unit tests proving it correctly distinguishes a genuinely tradeable net edge from a raw gap that doesn't clear real costs — validated against real MSFTB pool data, not synthetic numbers
- Dry-run + small live execution via Agentic Wallet
- The guardrail gate as independent, tested code (spend caps, dry-run floor, fail-closed behavior)
- Audit ledger of every decision (proposed, approved, rejected, executed)

**Mocked for demo:**
- Pool registry — hardcoded to the specific fee-tier pools independently verified this way (MSFTB's 0.25%/1% pair today) rather than a general pool-discovery scanner
- Multi-day autonomous x402 self-funding — shown at small scale on camera rather than run unattended for days

---

## 11. Build Steps

| Phase | Deliverable |
|---|---|
| 0. Setup | Repo scaffolding, Next.js app shell, env var contracts, Binance Web3 API + Agent Studio registration |
| 1. Data + Basis Model | Live quote ingestion for 3–5 underlyings; NAV-equivalent + adjusted-spread math; unit tests proving a known dividend-drift case is suppressed |
| 2. Guardrail Gate | Pure `check()` function, fully unit-tested independent of any LLM; spend caps, dry-run floor, sanity/liquidity checks |
| 3. Execution Wiring | Agentic Wallet integration; dry-run → small live execution path; audit ledger writer |
| 4. LLM Layer | Groq-backed intent parsing + plain-English proposal generation, fully isolated from execution |
| 5. Dashboard UI | Bento-grid layout, neo-brutalist styling, killswitch, wallet-split header, NAV chart, advisory feed, guardrail checklist, audit ledger view |
| 6. Hardening & Testing | Deliberately trigger a guardrail violation and confirm it blocks live; deliberately trigger a dividend-drift date and confirm suppression |
| 7. Submission | Demo video (≤4 min), DevEx report, deployment, repo freeze before submission deadline |

---

## 12. Technical Correctness Rules (Non-Negotiable)

1. The guardrail `check()` must be pure and side-effect-free, unit-tested completely independent of any LLM call.
2. LLM output must always be a schema-validated structured object. It is never permitted to construct or sign a transaction directly.
3. Every live execution is preceded by a dry-run/simulation call; the minimum-output floor is enforced in code, not merely requested of the model.
4. Spend limits (per-trade, per-day) are checked **before** any call goes out, not after. The gate fails closed on a limit violation.
5. The trading-capital wallet and the x402 operating-budget wallet are logically and financially separate; a failure or drain in one must not propagate to the other.
6. The fee-adjusted spread computation exists as its own tested module. A raw, unadjusted cross-pool price diff must never be used directly as an execution signal.
7. Every price feed passes a sanity-bounds check and a liquidity-depth check before being used in a spread calculation.
8. Audit ledger writes are append-only and happen for **every** decision — approved, blocked, or failed — not only for executed trades.
9. The killswitch state (Simulation / Dry-Run / Live) is checked on every execution attempt at the infrastructure layer, never cached at app load.
10. Secrets (Groq key, Binance Web3 API key, wallet credentials) never reach the client and are never committed to the repo.

---

## 13. Repository Expectations

- **Public repo**, matching the hackathon's mandatory submission requirement.
- **README** covering: one-liner, architecture diagram, setup steps, documented (not filled-in) required env vars, how a judge runs it — including how to switch between Dry-Run and Live — and the demo video link.
- **Folder structure:**
  ```
  /app                 — Next.js routes + dashboard UI
  /lib/data             — quote ingestion, dividend calendar
  /lib/basis-model      — NAV-equivalent + adjusted-spread math (+ tests)
  /lib/guardrails       — the pure check() gate (+ tests)
  /lib/execution        — Agentic Wallet integration, audit ledger writer
  /lib/llm              — Groq intent parsing + proposal generation
  /docs                 — Developer Experience Report
  ```
- A `.env.example` with every required variable name and no real values.
- Unit tests specifically covering the basis model and guardrail gate are non-optional — these are the two modules the entire trust argument rests on.
- Commit history reflecting work done inside the Sep 16 – Oct 11 window, since everything submitted must be built inside it.
- An open-source license file.

---

## 14. Judging Criteria Alignment

| Criterion | Weight | How this PRD addresses it |
|---|---|---|
| Technical implementation | 30% | NAV-adjusted spread model + independent guardrail gate + integrated single-loop execution |
| Creativity & originality | 25% | Total-return/price-return basis modeling is new to this space, though standard in TradFi ETF arbitrage |
| Developer Experience Report | 25% | Natural byproduct of integrating three differently-shaped protocols (xStocks/bStocks/Ondo) through one API |
| Product quality & UX | 20% | Plain-English proposals via Groq; visible, explainable guardrail decisions rather than a black box |

Stack awards targeted: **Best Use of Agentic Wallet/Wallet Skills** (isolated wallet + structural guardrails) and **Best Use of BNB Agent Studio** (identity + x402 self-funded operating budget, separated from trading capital).

---

## 15. Key Risk & Answer

**Likely objection:** "This is still just an arbitrage bot — how is the safety framing more than marketing?"

**Answer:** Demonstrate it live — show the naive price-diff signal firing falsely around a dividend date, then show the NAV-adjusted model correctly suppressing it, with the guardrail gate's decision logged and auditable rather than asserted.

---

## 16. Acceptance Criteria — Definition of Done

**Functional**
- [ ] Live pool prices render for each independently-verified fee-tier pool of the confirmed underlying(s) within the dashboard at an acceptable refresh latency.
- [ ] The fee-adjusted spread calculation demonstrably identifies at least one documented case where a real raw cross-pool gap does not clear trading costs (fees, slippage, gas) — a case a naive raw-diff bot would have flagged as a false signal.
- [ ] The guardrail gate visibly blocks at least one deliberately-triggered violation (e.g., an oversized order) live, not just in a unit test.
- [ ] A real, tested, end-to-end execution capability (dry-run → sign → broadcast) is demonstrated live on BSC mainnet. This is not a guaranteed positive outcome and is not staged either way: it plays out as either a real trade executing (if a genuine cost-net opportunity has cleared at recording time) or the guardrail correctly declining one (if it hasn't) — both are a valid pass, since the system doing real cost accounting instead of executing on any raw gap is the actual claim being tested.
- [ ] The audit ledger shows the complete chain for at least one trade: data fetch → guardrail check → TxID → x402 receipt (where applicable).
- [ ] The killswitch demonstrably changes agent behavior across all three states (Simulation / Dry-Run / Live).

**Submission**
- [ ] Public repo with README instructions a judge can follow standalone, with no undocumented setup steps.
- [ ] Demo video, four minutes or less.
- [ ] A deployed link, or clear fallback instructions if none.
- [ ] A specific, non-generic Developer Experience Report — this is 25% of score and explicitly rejects vague or AI-generated submissions.
- [ ] Both mandatory integrations present: Binance Web3 API and BNB Agent Studio. Missing either means the project isn't scored at all.
