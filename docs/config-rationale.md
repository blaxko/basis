# Config rationale

Every threshold in `lib/guardrails/config.ts` and `DEFAULT_AGENT_LOOP_CONFIG` (`lib/orchestration/agent-loop.ts`), its current value, and whether real data from this project supports it.

**Evidence used.** One live read of the two registered MSFTB PancakeSwap V3 pools, at BSC block 123812097 (2026-09-24 19:21:58 UTC), through a public RPC (`bsc-dataseed1.defibit.io`). It covered:

- `eth_gasPrice`
- `slot0()` and `liquidity()` on both pools
- QuoterV2 `quoteExactInputSingle` for USDT→MSFTB buys of $50, $200 and $500 on each pool
- BNB/USD from CoinGecko: $780.67. The Binance endpoints timed out from this machine.

This is one snapshot, not a time series. Treat every "measured" figure below as a single observation.

| Measured | 0.25% pool | 1% pool |
|---|---|---|
| Spot price | $497.2197 | $496.9976 |
| Liquidity estimate (virtual reserves at current tick) | ≈ $8.56M | ≈ $848k |
| Price impact beyond the fee, $50 / $200 / $500 buy | 0.0012% / 0.0047% / 0.0116% | 0.0117% / 0.0467% / 0.1166% |
| Output as % of input at spot, $200 buy | 99.745% | 98.954% |
| QuoterV2 gas estimate (swap only) | ~167k | ~138k |

Live gas price was 0.05 gwei. At $780.67/BNB, a ~167k-gas swap costs about **$0.0065 per leg**. The QuoterV2 figure leaves out the 21,000 base gas and router overhead, so real transactions cost somewhat more. Even at 300k gas the cost stays near $0.01.

## Guardrail config (`lib/guardrails/config.ts`)

| Setting | Value | Status |
|---|---|---|
| `perTradeCapUsd` | $500 | **Policy, not data.** A risk limit; no market data can justify it. The trading wallet is currently unfunded (0 BNB, 0 USDT), so the cap is not yet binding in practice. |
| `perDayCapUsd` | $2,000 | **Policy, not data.** Same as above. |
| `minDryRunOutputRatio` | 0.98 | **Consistent with the snapshot, not tuned.** Simulated output must be at least 98% of the order size. The measured $200 buys returned 99.745% (0.25% pool) and 98.954% (1% pool), so both pass. On the 1% pool that leaves under one point of headroom, because the 1% fee alone uses half the allowance. This is a sanity floor against a bad quote, not a profitability check. Before a QuoterV2 simulation has run, `check()` reports it as **pending**, not passed; the pipeline runs it on the real simulated output. |
| `maxPriceDeviationPct` | 5% | **Assumption, now active.** Each pool's current price must be within 5% of the median of its own recent readings (up to 60, one per scheduler tick), checked for **both** pools, since a bad reading on either side can fake an edge. The largest move observed on this pool set is 1.6% within an hour, so 5% should catch corrupted reads without tripping on normal movement. Not tuned beyond that. |
| `maxReferenceDivergencePct` | 2% | **Measured once; the limit is deliberately loose.** The buy-leg pool's spot price must be within 2% of the price implied by Binance's aggregator quote for the same token and size (`referencePriceCheck`). One same-moment reading at the $200 order size (2026-09-25 04:59 UTC, `docs/devex-log.md`) put the two pools 0.047% and 0.126% from the reference. **Why not tighter:** the limit also caps how far a pool may sit from the market and still be traded. A cross-pool edge exists because one pool lags the market; the 1% pool sat at $497.00 for hours on 2026-09-24 while the other moved. A tight limit would block the very lag the mechanism trades. The largest move observed on this pool set is 1.6% within an hour, so 2% keeps lags of that size tradeable and blocks larger gaps, which are likelier to be bad data or manipulation. **Spot, not fee-inclusive:** a pool's own fee isn't a data error; fee-inclusive, the 1% pool measured 0.87% off, over half the budget spent on its fee. **Independence is partial, not guaranteed.** In a 12-tick run (2026-09-25 05:06–05:11 UTC, $200), the best route was an RFQ market maker via LiquidMesh on 9 ticks (~$497.8). On 3 ticks it was "Pancakeswap V3" at $499.1361, which matches our own 0.25% pool plus its fee. At $1,000 the route was PancakeSwap V3 too. In that run the buy leg was the 1% pool, so no tick compared a pool with itself. But whenever the aggregator routes through the buy-leg pool, the check does compare that pool with itself, and can't catch it being wrong. The quote endpoint's `vendor` filter picks one vendor (`LiquidMesh`, `Pancake`, `Jupiter`); it can't exclude a venue. So the check reliably catches gross data errors, like a wrong decimal or a stale or corrupted read of the other pool, but not a manipulated PancakeSwap pool the aggregator also routes through. **No reference, no trade:** any failure to get a quote fails the check. |
| `minPriceHistoryReadings` | 10 | **Assumption.** The price check fails closed until both pools have this many readings, and no order is proposed until then. That's 5 minutes after a server start at the 30s tick. Only scheduler ticks record readings, never page loads or manual instructions, so the warm-up can't be shortened by traffic. 10 is enough for a median to mean something; it is not derived from data. |
| `sendSlippageTolerance` | 0.05% | **Chosen from data, deliberately tight.** The swap's on-chain `amountOutMinimum` is QuoterV2's simulated output less this. It only has to cover movement between the simulation and inclusion, which happen about a second apart; the simulated output already includes price impact. A too-tight tolerance costs one reverted transaction, about $0.01 of gas at the live price. A too-loose one hands the edge to a sandwich. It replaces a hardcoded 1%, which was larger than any edge this mechanism looks for. `slippageToleranceCheck` refuses any order whose net edge is not strictly above it, both at detection and again at the pre-send re-read. So the smallest edge that can proceed is effectively **5 bp**, not the 1 bp threshold below. |
| `minLiquidityDepthUsd` | $1,000 | **Assumption; never binding for these pools.** The measured estimates are about 850× (1% pool) and 8,500× (0.25% pool) above it. The estimate is a virtual-reserves proxy that overstates real depth, but a $500 quote crossed only one tick on either pool, which points the same way. |
| `minSpreadRetentionRatio` | 0.5 | **Assumption.** The fresh net edge must keep at least half of the detected edge. There is no data yet on how much edge decays between detection and the pre-send re-read, which happen within the same scheduler tick, about a second apart. The only movement observed is hour-scale: between two reads about an hour apart, which pool was cheaper flipped. |

## Agent loop config (`DEFAULT_AGENT_LOOP_CONFIG`)

| Setting | Value | Status |
|---|---|---|
| `underlyings` | tickers with ≥ 2 registered pools (today: `MSFT`) | **Data-backed.** Derived from `lib/data/pool-addresses.ts`, which only holds pools confirmed on-chain. |
| `adjustedSpreadThreshold` | 0.0001 (1 bp) | **Assumption.** An order is built only when the net edge is positive and above this. No positive live edge has been observed on the verified pairing, so there is nothing to tune it against. In practice the effective floor is 5 bp, because `sendSlippageTolerance` refuses anything smaller. |
| `gasSafetyMultiplier` | 2 | **Assumption, sized to what the live estimate leaves out.** Gas is now estimated live for both legs: QuoterV2's per-swap gas plus the 21,000 intrinsic gas per transaction, × live `eth_gasPrice`, × BNB/USD from the deepest PancakeSwap V3 WBNB/USDT pool (found on-chain from the verified SwapRouter's `factory()`/`WETH9()`, no hardcoded addresses). The multiplier covers what that leaves out: router overhead beyond the pool swap, gas-price moves between detection and send, and the one-off `approve` on first use (~46k gas). A literal `eth_estimateGas` on the swap isn't possible from an unfunded wallet with no allowance; it reverts. With the 2026-09-24 figures (0.05 gwei, 167k + 138k swap gas, BNB ≈ $777), the round trip comes to about **$0.027** including the ×2, about 8× below the old flat figure. |
| `fallbackGasCostUsd` | $0.21 (200k gas × 1.5 gwei × $700 BNB) | **Conservative fallback only.** Used when any part of the live estimate fails, and each use is logged to the server console and recorded on the ledger entry (`gas.source: "fallback"`, shown as FALLBACK on the dashboard). It overstates costs about 8× against the live round trip, so a failure errs toward declining, never toward trading. |
| `slippagePctEstimate` | 0.05% | **Roughly matches data at $200, but size-blind.** Measured $200 buy impact was 0.0047% + 0.0467% across the two pools, about 0.05% combined. The sell leg was not measured. The estimate is a flat percentage, while real impact scales with size (0.12% at $500 on the 1% pool alone). So it understates cost for larger orders. |
| `orderSizeUsd` | $200 | **Unresolved tradeoff, deliberately not picked.** See below. |

### `orderSizeUsd`: why it stays open

Two costs pull in opposite directions:

- **Gas is a fixed dollar cost**, so its share of the trade shrinks as size grows.
- **Price impact grows with size.** The model does not capture this: `slippagePctEstimate` is flat.

Which one wins depends on the gas regime. The live estimate is now what the model uses, but the fallback is still the old flat figure:

| Size | Gas share per leg (fallback $0.21) | Gas share per leg (live $0.0065) | Impact beyond fee, 1% pool buy (measured) |
|---|---|---|---|
| $50 | 0.42% | 0.013% | 0.0117% |
| $200 | 0.105% | 0.0033% | 0.0467% |
| $500 | 0.042% | 0.0013% | 0.1166% |

- **At the fallback gas cost,** gas dominates, so larger orders look cheaper.
- **At the live gas price,** gas is negligible at every size tested, and impact dominates, so smaller orders are cheaper.

The answer flips with the gas regime. Only one gas-price reading has been taken, and the model cannot yet express size-dependent impact. Picking a number now would mean picking a gas regime without evidence. For either pool pairing seen so far, both effects are small next to the fees themselves (1.25% round trip for 0.25% + 1%). So resolving this would not change the current conclusion that the verified pairing does not clear.

## Other constants worth knowing

| Constant | Value | Status |
|---|---|---|
| `DEFAULT_GAS_COST_USD_ESTIMATE`, `DEFAULT_SLIPPAGE_PCT_ESTIMATE` (`lib/execution/pipeline.ts`) | $0.21, 0.05% | Used only when a caller doesn't pass the gas figure its detection used. Both order builders always pass it, so the pre-send re-read prices gas exactly as detection did. Kept separate so `execution/` doesn't import `orchestration/`. |
| Price history bound (`lib/data/price-history.ts`) | 60 readings per pool | **Assumption.** 30 minutes at the 30s tick; the median in `priceSanityCheck` is taken over what's kept. |
| `DEFAULT_SCHEDULER_INTERVAL_MS` | 30s | **Assumption.** Chosen for demo pacing, not from data. |
