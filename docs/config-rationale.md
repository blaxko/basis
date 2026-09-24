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
| `minDryRunOutputRatio` | 0.98 | **Consistent with the snapshot, not tuned.** Simulated output must be at least 98% of the order size. The measured $200 buys returned 99.745% (0.25% pool) and 98.954% (1% pool), so both pass. On the 1% pool that leaves under one point of headroom, because the 1% fee alone uses half the allowance. This is a sanity floor against a bad quote, not a profitability check. Profitability is checked by the net edge and `spreadFreshnessCheck`. |
| `maxPriceDeviationPct` | 5% | **Assumption, and currently inert.** Both order construction sites pass `recentTicks: []`, and `priceSanityCheck` accepts any positive price when history is empty. It will not constrain anything until a tick-history store exists. |
| `minLiquidityDepthUsd` | $1,000 | **Assumption; never binding for these pools.** The measured estimates are about 850× (1% pool) and 8,500× (0.25% pool) above it. The estimate is a virtual-reserves proxy that overstates real depth, but a $500 quote crossed only one tick on either pool, which points the same way. |
| `minSpreadRetentionRatio` | 0.5 | **Assumption.** The fresh net edge must keep at least half of the detected edge. There is no data yet on how much edge decays between detection and the pre-send re-read, which happen within the same scheduler tick, about a second apart. The only movement observed is hour-scale: between two reads about an hour apart, which pool was cheaper flipped. |

## Agent loop config (`DEFAULT_AGENT_LOOP_CONFIG`)

| Setting | Value | Status |
|---|---|---|
| `underlyings` | tickers with ≥ 2 registered pools (today: `MSFT`) | **Data-backed.** Derived from `lib/data/pool-addresses.ts`, which only holds pools confirmed on-chain. |
| `adjustedSpreadThreshold` | 0.0001 (1 bp) | **Assumption.** An order is built only when the net edge is positive and above this. No positive live edge has been observed on the verified pairing, so there is nothing to tune it against. Note that it sits well below the model's own error: the gas term alone is overstated by about 0.1% at $200, as the next row explains. That error runs in the conservative direction today, so a computed +1 bp edge would likely be larger in reality, not smaller. |
| `gasCostUsdEstimate` | $0.21 (200k gas × 1.5 gwei × $700 BNB) | **Assumption, contradicted by live data.** The live figures (0.05 gwei, ~138k–167k swap gas, $780.67 BNB) give about $0.0065 per leg, roughly 30× lower. The overstatement is conservative: it makes edges look worse, never better. The value is left unchanged because changing it shifts every net-edge figure in the tests and fixtures, which is a separate decision. Suggested replacement: live `eth_gasPrice` × the QuoterV2 gas estimate plus a fixed overhead. |
| `slippagePctEstimate` | 0.05% | **Roughly matches data at $200, but size-blind.** Measured $200 buy impact was 0.0047% + 0.0467% across the two pools, about 0.05% combined. The sell leg was not measured. The estimate is a flat percentage, while real impact scales with size (0.12% at $500 on the 1% pool alone). So it understates cost for larger orders. |
| `orderSizeUsd` | $200 | **Unresolved tradeoff, deliberately not picked.** See below. |

### `orderSizeUsd`: why it stays open

Two costs pull in opposite directions:

- **Gas is a fixed dollar cost**, so its share of the trade shrinks as size grows.
- **Price impact grows with size.** The model does not capture this: `slippagePctEstimate` is flat.

Which one wins depends on which gas figure you believe:

| Size | Gas share per leg (assumed $0.21) | Gas share per leg (live $0.0065) | Impact beyond fee, 1% pool buy (measured) |
|---|---|---|---|
| $50 | 0.42% | 0.013% | 0.0117% |
| $200 | 0.105% | 0.0033% | 0.0467% |
| $500 | 0.042% | 0.0013% | 0.1166% |

- **At the assumed gas cost,** gas dominates, so larger orders look cheaper.
- **At the live gas price,** gas is negligible at every size tested, and impact dominates, so smaller orders are cheaper.

The answer flips with the gas regime. Only one gas-price reading has been taken, and the model cannot yet express size-dependent impact. Picking a number now would mean picking a gas regime without evidence. For either pool pairing seen so far, both effects are small next to the fees themselves (1.25% round trip for 0.25% + 1%). So resolving this would not change the current conclusion that the verified pairing does not clear.

## Other constants worth knowing

| Constant | Value | Status |
|---|---|---|
| `SEND_SLIPPAGE_TOLERANCE_BPS` (`lib/execution/pipeline.ts`) | 1% | **Assumption, and loose relative to data.** The on-chain `amountOutMinimum` is simulated output minus 1%. Measured impact at $200 is about 0.05%, so the tolerance leaves about 0.95% for a sandwich or adverse move to take. That is larger than any edge this mechanism is looking for. **Recommend tying it to the order's own net edge before any live send.** |
| `DEFAULT_GAS_COST_USD_ESTIMATE`, `DEFAULT_SLIPPAGE_PCT_ESTIMATE` (`lib/execution/pipeline.ts`) | same as agent loop | Duplicates of the agent-loop defaults, kept separate so `execution/` doesn't import `orchestration/`. Same status as above; change both together. |
| `DEFAULT_SCHEDULER_INTERVAL_MS` | 30s | **Assumption.** Chosen for demo pacing, not from data. |
