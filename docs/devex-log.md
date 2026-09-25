# Binance Web3 API — DevEx log

Raw facts only. One entry per interaction, appended in order. Not the Developer Experience Report.

Keys, secrets, and signature values are never recorded.

---

## 2026-09-24 ~21:25 UTC — Config

- `BINANCE_WEB3_API_BASE_URL` in `.env.local`: empty.
- Set to: `https://web3.binance.com/build`
- `BINANCE_WEB3_API_KEY`: set (39 chars). `BINANCE_WEB3_API_SECRET`: set (32 chars).

## 2026-09-24 ~21:26 UTC — DNS, web3.binance.com

- Network DNS resolver: `192.168.0.1`
- `nslookup web3.binance.com` (default resolver): `DNS request timed out. timeout was 2 seconds.` (twice)
- `curl https://web3.binance.com/en/dev-docs`: exit code 6, `HTTP 000 in 11.368402s`
- `nslookup web3.binance.com 1.1.1.1`: `3.173.161.37`, `3.173.161.104`, `3.173.161.28`
- `nslookup web3.binance.com 8.8.8.8`: `108.156.221.91`, `108.156.221.120`, `108.156.221.129`
- Cloudflare DNS-over-HTTPS: CNAME `dnsu8oml1p86w.cloudfront.net.` → `3.173.161.34`, `3.173.161.37`, `3.173.161.104`, `3.173.161.28`
- Workaround used for the calls below: resolve via `1.1.1.1` per request. Machine/app DNS unchanged — **open**.
- Same network, earlier the same day (other Binance hosts):
  - `api.binance.com`: `ConnectTimeoutError: Connect Timeout Error (attempted address: api.binance.com:443, timeout: 10000ms)`
  - `data-api.binance.vision`: `The operation was aborted due to timeout` (8s client timeout)
  - `bsc-dataseed.binance.org` (JSON-RPC via viem): `The request took too long to respond.`

## 2026-09-24 ~21:27 UTC — Docs access

| Client | URL | Result |
|---|---|---|
| WebFetch tool | `https://web3.binance.com/en/dev-docs` | `getaddrinfo ENOTFOUND web3.binance.com` |
| curl, `--resolve web3.binance.com:443:3.173.161.28` | `https://web3.binance.com/en/dev-docs` | `HTTP 202 text/html; charset=UTF-8 0B in 1.120614s` |
| Headless Chrome, `--host-resolver-rules=MAP web3.binance.com 3.173.161.28`, 9s wait | `https://web3.binance.com/en/dev-docs` | Rendered; redirected to `/en/dev-docs/introduction`, title `Overview \| Binance Web3 API`, 2,031 chars |
| Same, 9s wait | `https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api` | 70 chars of text, title empty |
| Same, 25s wait | same | Redirected to `…/rest-api/general-data`, 67,952 chars, 164 doc links |
| Same | `https://web3.binance.com/en/dev-docs/llms-full.txt` | 438,824 chars |
| Same | `https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/1.0.0/schema.json` | `openapi 3.0.2`, `info.title "Binance Web3 API"`, `info.version "1.0.0"`, 65 paths |

- Schema, `POST /api/v1/dex/pre-transaction/simulate`, `evmTx.data`: listed in `required`; description text: `ABI-encoded calldata (hex). Optional.`

## 2026-09-24 21:32:02.228Z (server timestamp) — First API call

- Method / endpoint: `GET /api/v1/dex/aggregator/quote`
- Full URL: `https://web3.binance.com/build/api/v1/dex/aggregator/quote?binanceChainId=56&amount=10000000000000000000&fromTokenAddress=0x55d398326f99059fF775485246999027B3197955&toTokenAddress=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0&userWalletAddress=0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7`
- Params: chain 56 (BSC); 10 USDT in (18 decimals); USDT → MSFTB; `userWalletAddress` = trading wallet (public address); no `vendor`.
- Auth headers sent: `X-OC-APIKEY`, `X-OC-TIMESTAMP` (ISO 8601 with ms), `X-OC-SIGN` (HMAC-SHA256, base64, preHash = timestamp + method + path-with-`/build` + query + body). Signed by `buildAuthHeaders` in `lib/data/quotes.ts`, unchanged.
- HTTP status: `200`
- Latency: `1484 ms` (request start to last byte)
- `code`: `0`, `msg`: `success`
- Routes returned: 1
- Response body, verbatim:

```json
{"code":0,"msg":"success","data":[{"quoteId":"58a214eac501420b9ea583de68bbeb07","vendorName":"LiquidMesh","executionMode":"SWAP","binanceChainId":"56","fromTokenAmount":"10000000000000000000","toTokenAmount":"20046272006646378","tradeFee":"0.0185302","estimateGasFee":"450000","priceImpactPercent":"0.0000000000","router":"0x55d398326f99059ff775485246999027b3197955--0x80106cb3ead06659a5ad19df39d9b4733863b9b0","fromToken":{"tokenContractAddress":"0x55d398326f99059fF775485246999027B3197955","tokenSymbol":"USDT","tokenUnitPrice":"0.9998081914060256","decimal":"18","isHoneyPot":false,"taxRate":"0"},"toToken":{"tokenContractAddress":"0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0","tokenSymbol":"MSFTB","tokenUnitPrice":"498.06357924776500237145000000","decimal":"18","isHoneyPot":false,"taxRate":"0"},"dexRouterList":[{"dexProtocol":{"dexName":"Rfq Neptunex","percent":"100.00"},"fromToken":{"tokenContractAddress":"0x55d398326f99059ff775485246999027b3197955","tokenSymbol":"USDT","tokenUnitPrice":"0.9998081914060256","decimal":"18","isHoneyPot":false,"taxRate":"0"},"fromTokenIndex":"0","toToken":{"tokenContractAddress":"0x80106cb3ead06659a5ad19df39d9b4733863b9b0","tokenSymbol":"MSFTB","tokenUnitPrice":"498.06357924776500237145000000","decimal":"18","isHoneyPot":false,"taxRate":"0"},"toTokenIndex":"1"}],"approveTarget":"0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5","isBest":true,"feeAmount":null,"feeToken":null,"actualSwapAmount":null}],"timestamp":1790285522228,"success":true}
```

- Derived: 10 USDT / 0.020046272006646378 MSFTB = 498.8459 USD per MSFTB (quote-implied). Response `toToken.tokenUnitPrice`: 498.0636.
- Client-side failure before this call (no request reached Binance): Node `https` custom `lookup` called with `{ all: true }` → `TypeError: Invalid IP address: undefined`. Fixed by returning an address array when `all` is set.

## 2026-09-25 04:59:28.447Z (server timestamp) — Quote at order size, same moment as pool reads

- Method / endpoint: `GET /api/v1/dex/aggregator/quote`
- Params: `binanceChainId=56`, `amount=200000000000000000000` (200 USDT), `fromTokenAddress=0x55d398326f99059fF775485246999027B3197955`, `toTokenAddress=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0`, `userWalletAddress=0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7`
- Client: `fetchAggregatorReference` (`lib/data/binance-reference.ts`), signed by `buildAuthHeaders`; DNS via `1.1.1.1` (workaround from 2026-09-24).
- HTTP status: `200` (`code 0`, `success: true`)
- Latency: not captured separately (the log line was dropped by output filtering). The whole probe — this call plus two pools' on-chain reads, in parallel — took `1387 ms`.
- Routes returned: 1
- Response body, verbatim:

```json
{"code":0,"msg":"success","data":[{"quoteId":"93e17cd2460e4120b064d8e00ca164b1","vendorName":"LiquidMesh","executionMode":"SWAP","binanceChainId":"56","fromTokenAmount":"200000000000000000000","toTokenAmount":"401904253970946590","tradeFee":"0.02001743","estimateGasFee":"450000","priceImpactPercent":"0.0000000000","router":"0x55d398326f99059ff775485246999027b3197955--0x80106cb3ead06659a5ad19df39d9b4733863b9b0","fromToken":{"tokenContractAddress":"0x55d398326f99059fF775485246999027B3197955","tokenSymbol":"USDT","tokenUnitPrice":"0.9996492786708756","decimal":"18","isHoneyPot":false,"taxRate":"0"},"toToken":{"tokenContractAddress":"0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0","tokenSymbol":"MSFTB","tokenUnitPrice":"497.43275144991998125910000000","decimal":"18","isHoneyPot":false,"taxRate":"0"},"dexRouterList":[{"dexProtocol":{"dexName":"Rfq Neptune","percent":"100.00"},"fromToken":{"tokenContractAddress":"0x55d398326f99059ff775485246999027b3197955","tokenSymbol":"USDT","tokenUnitPrice":"0.9996492786708756","decimal":"18","isHoneyPot":false,"taxRate":"0"},"fromTokenIndex":"0","toToken":{"tokenContractAddress":"0x80106cb3ead06659a5ad19df39d9b4733863b9b0","tokenSymbol":"MSFTB","tokenUnitPrice":"497.43275144991998125910000000","decimal":"18","isHoneyPot":false,"taxRate":"0"},"toTokenIndex":"1"}],"approveTarget":"0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5","isBest":true,"feeAmount":null,"feeToken":null,"actualSwapAmount":null}],"timestamp":1790312368447,"success":true}
```

- Derived: 200 / 0.40190425397094659 = 497.6310 USD per MSFTB.
- `dexName` in this response: `Rfq Neptune`. In the 2026-09-24 21:32 response: `Rfq Neptunex`.
- Same-moment on-chain reads (PancakeSwap V3, via `bsc-dataseed1.defibit.io`):

| Pool | Spot | Spot vs reference | Spot × (1 + fee) | Fee-inclusive vs reference |
|---|---|---|---|---|
| 0.25% `0x5018…e7ea` | 497.8647 | 0.047% | 499.1094 | 0.297% |
| 1% `0x58e4…5b44` | 497.0062 | 0.126% | 501.9763 | 0.873% |

## 2026-09-25 ~05:05 UTC — Unsigned reachability probe from Node

- Method / endpoint: `GET https://web3.binance.com/build/api/v1/dex/aggregator/quote` (no params, no auth headers)
- Node `fetch`, system DNS: `ENOTFOUND` (request not sent)
- Node `fetch`, `*.binance.com` resolved via `1.1.1.1` (preload script, local only): HTTP `401`. Response body not captured.

## 2026-09-25 05:06:09 – 05:11:37 UTC — App runtime, scheduler, $200 quotes

- Client: the app (`defaultFetchReference` → `fetchAggregatorReference`), production build, one call per 30s scheduler tick. DNS for `*.binance.com` via `1.1.1.1` (local preload script, not in the repo).
- Calls seen in the ledger: 12. More may have run before shutdown (not captured).
- All 12 returned a usable quote. Per-call HTTP status and latency are not recorded by the app.
- Params each call: `binanceChainId=56`, `amount=200000000000000000000`, USDT → MSFTB, `userWalletAddress=0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7`.

| Tick (UTC) | Implied USD/MSFTB | `vendorName` / `dexName` |
|---|---|---|
| 05:06:09 | 497.7408 | LiquidMesh / Rfq Neptunex |
| 05:06:37 | 497.8226 | LiquidMesh / Rfq Neptunex |
| 05:07:07 | 497.8214 | LiquidMesh / Rfq Neptunex |
| 05:07:37 | 499.1361 | LiquidMesh / Pancakeswap V3 |
| 05:08:07 | 497.8373 | LiquidMesh / Rfq Neptunex |
| 05:08:37 | 499.1361 | LiquidMesh / Pancakeswap V3 |
| 05:09:07 | 497.8064 | LiquidMesh / Rfq Neptunex |
| 05:09:37 | 497.9041 | LiquidMesh / Rfq Neptunex |
| 05:10:07 | 497.9141 | LiquidMesh / Rfq Neptunex |
| 05:10:37 | 497.9075 | LiquidMesh / Rfq Neptunex |
| 05:11:08 | 499.1361 | LiquidMesh / Pancakeswap V3 |
| 05:11:37 | 497.9314 | LiquidMesh / Rfq Neptunex |

- Same window, on-chain: 1% pool spot `497.0062` on every tick; 0.25% pool spot `497.86` (dashboard). 497.86 × 1.0025 = 499.10.

## 2026-09-25 05:11:09 UTC — App runtime, manual instruction, $1,000 quote

- Triggered by `POST /api/instruction` `{"instruction":"buy 1000 dollars of MSFT"}`; `/api/instruction` answered HTTP 200 in 3.51 s (includes the Groq call, pool reads, gas estimate, and this quote).
- Params: `amount=1000000000000000000000` (1,000 USDT), otherwise as above.
- Result: `{"status":"ok","priceUsd":499.23057540845537,"vendor":"LiquidMesh","route":"Pancakeswap V3"}`

## 2026-09-25 ~05:27 UTC — DNS fixed on this machine

- `nslookup web3.binance.com` (system resolver): `3.173.161.104`, `3.173.161.34`, `3.173.161.37`, `3.173.161.28`
- Node `dns.lookup("web3.binance.com")`: same four addresses.
- Local workaround removed: the preload script is deleted, the headless-Chrome host mapping is removed from the scratchpad docs reader, and none of it was ever in the repo. Closes the "open" item from 2026-09-24.

## 2026-09-25 05:27:33.177Z — First in-app call without any DNS workaround

- Client: the app's scheduler tick (`defaultFetchReference` → `fetchAggregatorReference`), production build (`next start`), system DNS.
- Method / endpoint: `GET /api/v1/dex/aggregator/quote`, `binanceChainId=56`, `amount=200000000000000000000` (200 USDT), USDT → MSFTB, `userWalletAddress=0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7`
- Result recorded on the ledger entry: `{"status":"ok","priceUsd":497.8385329698283,"vendor":"LiquidMesh","route":"Rfq Neptunex"}`
- HTTP status / latency: not recorded by the app at this point (per-call recording not yet built).

## 2026-09-25 05:27:33 – 05:32:01 UTC — App runtime, system DNS, $200 quotes

- 10 scheduler calls in the ledger. All 10 returned a usable quote. Per-call HTTP status and latency are not recorded by the app yet.

| Tick (UTC) | Implied USD/MSFTB | `dexName` |
|---|---|---|
| 05:27:33 | 497.8385 | Rfq Neptunex |
| 05:28:01 | 497.8552 | Rfq Neptune |
| 05:28:31 | 499.1361 | Pancakeswap V3 |
| 05:29:01 | 498.1786 | Rfq Neptunex |
| 05:29:31 | 498.1775 | Rfq Neptunex |
| 05:30:02 | 499.1361 | Pancakeswap V3 |
| 05:30:31 | 498.1487 | Rfq Neptunex |
| 05:31:00 | 498.1770 | Rfq Neptunex |
| 05:31:32 | 498.2755 | Rfq Neptunex |
| 05:32:01 | 499.0870 | Pancakeswap V3 |

## 2026-09-25 ~05:33 UTC — App runtime, system DNS, manual instruction, $1,000 quote

- `POST /api/instruction` `{"instruction":"buy 1000 dollars of MSFT"}` → HTTP 200 in 2.26 s (includes Groq, pool reads, gas, this quote).
- Quote result: `{"status":"ok","priceUsd":498.3540166628839,"vendor":"LiquidMesh","route":"Rfq Neptunex"}`

## 2026-09-25 05:38:22.919Z — Transaction API simulate: our exactInputSingle, unfunded wallet

- Method / endpoint: `POST /api/v1/dex/pre-transaction/simulate`
- Client: `binanceRequest` (`lib/data/binance-client.ts`), HMAC over timestamp + method + path + JSON body. System DNS.
- Request body, verbatim:

```json
{"binanceChainId":"56","evmTx":{"from":"0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7","to":"0x1b81D678ffb9C0263b24A97847620C99d213eB14","value":"0","data":"0x414bf38900000000000000000000000055d398326f99059ff775485246999027b319795500000000000000000000000080106cb3ead06659a5ad19df39d9b4733863b9b000000000000000000000000000000000000000000000000000000000000009c40000000000000000000000005b281f6e028466ceeb8b8fb6685e35ec2b8f02f7000000000000000000000000000000000000000000000000000000006ab60b260000000000000000000000000000000000000000000000004563918244f400000000000000000000000000000000000000000000000000000023938220a24c340000000000000000000000000000000000000000000000000000000000000000"}}
```

- Calldata: PancakeSwap V3 SwapRouter `exactInputSingle`, USDT → MSFTB, fee 2500, recipient = trading wallet, `amountIn` 5 USDT, `amountOutMinimum` = QuoterV2 output `10018820697760644` less 0.05%.
- Wallet state: 0 BNB, 0 USDT, no USDT allowance for the SwapRouter.
- HTTP status: `200`. Latency: `1423 ms`.
- Response, verbatim:

```json
{"code":0,"msg":"success","data":{"status":"FAILED","failReason":"execution reverted: STF","balanceChanges":[],"allowanceChanges":[]},"timestamp":1790314704072,"success":true}
```

## 2026-09-25 05:38:24.344Z — Transaction API simulate: USDT approve(), unfunded wallet

- Method / endpoint: `POST /api/v1/dex/pre-transaction/simulate`
- Request body, verbatim:

```json
{"binanceChainId":"56","evmTx":{"from":"0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7","to":"0x55d398326f99059fF775485246999027B3197955","value":"0","data":"0x095ea7b30000000000000000000000001b81d678ffb9c0263b24a97847620c99d213eb140000000000000000000000000000000000000000000000004563918244f40000"}}
```

- Calldata: USDT `approve(SwapRouter 0x1b81…eB14, 5 USDT)`.
- HTTP status: `200`. Latency: `760 ms`.
- Response, verbatim:

```json
{"code":0,"msg":"success","data":{"status":"SUCCESS","failReason":"","balanceChanges":[],"allowanceChanges":[{"tokenAddress":"0x55d398326f99059ff775485246999027b3197955","owner":"0x5b281f6e028466ceeb8b8fb6685e35ec2b8f02f7","spender":"0x1b81d678ffb9c0263b24a97847620c99d213eb14","preAmount":"0","postAmount":"5000000000000000000"}]},"timestamp":1790314704845,"success":true}
```

- Observed `status` values: `FAILED`, `SUCCESS`. On `SUCCESS`, `failReason` is `""`; the schema describes it as "Failure reason when `status=FAILED`; otherwise null."
- The simulation needs no gas balance on the sender (the approve simulated `SUCCESS` from a 0-BNB wallet).

## 2026-09-25 05:38:24 – 10:33 UTC — No Binance Web3 API calls

- The two simulate calls above were the last Binance calls before the 10:33 UTC restart. (An earlier status report said "this round made no new Binance calls"; that was wrong — it meant the later gas and storage-slot probes, which used only the BSC RPC.)
- 06:21 – 10:33 UTC: a production server ran with `BSC_RPC_URL` empty. Every scheduler tick failed at the pool read (`MSFT: failed — NotImplemented: BSC_RPC_URL is not set`). The reference quote is fetched only after the pool reads, and itself starts with an RPC read, so no tick reached Binance. That server's in-memory call log was lost when it stopped; this is from the code path and the server log, not the call log.

## 2026-09-25 ~10:33 UTC — Trading wallet changed

- Entries before this point used the trading wallet `0x5B281F6E028466CEEB8b8FB6685e35eC2B8f02f7` (as `userWalletAddress` in quotes and `from` in simulations).
- Entries from here on use `0x0bA556a253D2f1FdCF352aD55A5b44718802BB95`.
- Balances of the new wallet at BSC block 123933693 (10:34:08 UTC, read through the configured `BSC_RPC_URL`): 0.00292984 BNB, 5 USDT.

## 2026-09-25 10:34:05 – 11:07:34 UTC — App runtime, first calls with per-call status and latency

- Client: the app's scheduler (`GET /api/v1/dex/aggregator/quote`, 200 USDT → MSFTB, `userWalletAddress=0x0bA556a253D2f1FdCF352aD55A5b44718802BB95`), production build, recorded by `lib/data/binance-client.ts`, read from `/api/status`.
- 45 calls: 8 ok, 37 failed. Latency over calls that got an HTTP response: p50 2979 ms, p95 8969 ms, max 8969 ms.

Successful calls (HTTP 200, code 0):

| Call start (UTC) | Latency ms | Implied USD/MSFTB | `dexName` |
|---|---|---|---|
| 10:34:05.088 | 1343 | 498.0904 | Rfq Neptunex |
| 10:34:33.735 | 773 | 498.8453 | Pancakeswap V3 |
| 10:35:03.142 | 913 | 498.8453 | Pancakeswap V3 |
| 10:36:42.212 | 3411 | 498.0430 | Rfq Neptunex |
| 10:43:11.743 | 1431 | 498.1434 | Rfq Neptunex |
| 10:47:05.117 | 2979 | 498.8453 | Pancakeswap V3 |
| 10:50:23.174 | 6325 | 498.0493 | Rfq Neptunex |
| 10:51:02.497 | 1712 | 498.8453 | Pancakeswap V3 |

Failures:

- 3 × HTTP 401, code 40103, verbatim:
  - call 10:35:59.026Z, 8969 ms: `{"msg":"Timestamp outside recv_window. serverTime=2026-09-25T10:36:06.720933596Z","timestamp":1790332566721,"code":40103,"data":""}`
  - call 10:42:43.058Z, 5262 ms: `{"msg":"Timestamp outside recv_window. serverTime=2026-09-25T10:42:48.125488273Z","timestamp":1790332968125,"code":40103,"data":""}`
  - call 10:47:40.422Z, 7779 ms: `{"msg":"Timestamp outside recv_window. serverTime=2026-09-25T10:47:46.494557150Z","timestamp":1790333266494,"code":40103,"data":""}`
  - Local clock checked at 11:05:43 UTC against `www.google.com`'s `Date` header: identical to the second. `X-OC-TIMESTAMP` is set when the request is built; these requests took 5.3–9.0 s end to end, past the default 5000 ms `X-OC-RECV-WINDOW` (docs: default 5000, max 60000). The app does not send `X-OC-RECV-WINDOW`.
- 34 × no HTTP response: `TimeoutError: The operation was aborted due to timeout` (the app's 10 s limit). Continuous from 10:54:03 onward.
- Network at the time:
  - `nslookup web3.binance.com` → server `172.20.10.1`; `dnsu8oml1p86w.cloudfront.net`, `108.156.221.91`. (Earlier today, on the system resolver: `3.173.161.x`.)
  - `curl -sv https://web3.binance.com/build/api/v1/dex/aggregator/supported/chain` at ~11:05 UTC: TCP connect in 0.069 s, then `Recv failure: Connection was reset` / `schannel: failed to receive handshake, SSL/TLS connection failed`.
  - 5 further attempts 11:05:59 – 11:07:08 UTC: all `exit 28` (timeout at 12 s), no TLS handshake completed.
  - `https://www.google.com` from the same machine at the same time: HTTP response received.
- Effect in the app: the manual instruction at 11:04:22 UTC ("Buy $200 of MSFT", ledger `ledger_1790334272923_38`) was blocked by `referencePriceCheck`: `no Binance reference quote: The operation was aborted due to timeout`. Fail-closed, as designed.

## 2026-09-25 11:39 – 11:48 UTC — Compliance restriction (40304) through a US VPN exit

- 11:39:57 – 11:45:54 UTC: 13 scheduler calls, no HTTP response (`TimeoutError: The operation was aborted due to timeout`), same network as the 10:54 entry.
- From 11:46 UTC the machine was on a VPN: adapter `ProTUN` (`10.2.0.2`), DNS server `10.2.0.1`; `nslookup web3.binance.com` → `18.161.21.5`. Cloudflare trace for the connection: `loc=US`, `colo=EWR`.
- 3 scheduler calls, `GET /api/v1/dex/aggregator/quote` (200 USDT → MSFTB, `userWalletAddress=0x0bA556a253D2f1FdCF352aD55A5b44718802BB95`), each sent with `X-OC-RECV-WINDOW: 15000`:

| Call start (UTC) | HTTP | Latency ms | Code | Message (verbatim, as recorded by the app) |
|---|---|---|---|---|
| 11:46:40.393 | 200 | 2698 | 40304 | `Service not available due to compliance restriction` |
| 11:46:57.613 | 200 | 2318 | 40304 | `Service not available due to compliance restriction` |
| 11:48:03.183 | 200 | 1553 | 40304 | `Service not available due to compliance restriction` |

- Unsigned `GET /build/api/v1/dex/aggregator/supported/chain` via curl at 11:47:03 UTC: HTTP 401, TLS 1.23 s, total 1.83 s.
- The US is on the prohibited list (web3.binance.com/en/dev-docs/web3-api-prohibited-regions). 40304 is documented as "The request is blocked by a compliance rule not covered by a more specific code above" (IP Compliance table, alongside 40301 region / 40302 VPN or proxy). The response is HTTP 200 with a non-zero `code`, so the app's call log records the code and `msg`, not the full body.
- These calls do not verify `X-OC-RECV-WINDOW`: they were refused by the compliance layer, not checked against the time window.
- The local server was stopped at ~11:49 UTC to stop sending calls from a restricted-region IP.

## 2026-09-25 ~11:55 – 12:03 UTC — Direct home connection; `X-OC-RECV-WINDOW` verified

- Network: VPN disconnected; Wi-Fi only (`192.168.0.196`); DNS `1.1.1.1`; `web3.binance.com` → `3.173.161.34`. Cloudflare trace: `loc=NG` (not on the prohibited list), `colo=AMS`.
- Two one-off signed calls from Node through `binanceRequest` (`GET /api/v1/dex/aggregator/supported/chain`) got no response within the app's 10 s timeout (`TimeoutError: The operation was aborted due to timeout`), ~11:55 and ~11:58 UTC. Unsigned curl requests at 11:56:23 / 11:56:28 / 11:56:32 UTC: HTTP 401 in 2.51 / 1.29 / 1.48 s. Unsigned Node `fetch` at 12:00:35 UTC: HTTP 401 in 3721 ms.
- Signed `GET /build/api/v1/dex/aggregator/supported/chain` via curl with `X-OC-RECV-WINDOW: 15000`, fresh timestamp, 12:00:36 UTC: HTTP 200 in 5.78 s, `"code":0`, `"success":true` (list of supported chains). The unsigned header does not break the signature.
- Same endpoint, `X-OC-TIMESTAMP` deliberately 8 s old:

| Step | `X-OC-TIMESTAMP` | `X-OC-RECV-WINDOW` | Finished (UTC) | HTTP | Total s | Response (verbatim, truncated) |
|---|---|---|---|---|---|---|
| without header | 2026-09-25T12:00:56.423Z | not sent | 12:01:09.092 | 401 | 4.51 | `{"msg":"Timestamp outside recv_window. serverTime=2026-09-25T12:01:08.153960274Z","data":"","code":40103,"timestamp":1790337668154}` |
| with header | 2026-09-25T12:01:01.465Z | `15000` | 12:01:13.528 | 200 | 3.91 | `{"code":0,"msg":"success","data":[{"binanceChainId":"1","name":"Ethereum",…` |

- Server restarted (production build with the header): first three scheduler quote calls, 200 USDT → MSFTB:

| Call start (UTC) | HTTP | Latency ms | Code |
|---|---|---|---|
| 12:02:00.575 | 200 | 9919 | 0 |
| 12:02:30.742 | 200 | 7139 | 0 |
| 12:02:59.013 | 200 | 9654 | 0 |

- All three took longer than Binance's default 5,000 ms window; with the default they would be at risk of `40103`.

## 2026-09-25 12:06:16.554Z — RWA Data API: `GET /api/v1/dex/market/rwa/underlying-market`, MSFTB

- Client: curl with the app's signing scheme (HMAC over timestamp + `GET` + `/build` path + query), `X-OC-RECV-WINDOW: 15000`. Direct home connection.
- Query: `binanceChainId=56&tokenContractAddress=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0`
- HTTP status: `200`. Total time: 2.04 s. (Friday, 08:06 US Eastern.)
- Response, verbatim:

```json
{"code":0,"msg":"success","data":{"binanceChainId":"56","tokenContractAddress":"0x80106cb3ead06659a5ad19df39d9b4733863b9b0","platformId":"bstock","assetType":1,"statusInfo":{"openState":true,"marketStatus":null,"reasonCode":"TRADING","reasonMsg":null,"nextOpenTime":null,"nextCloseTime":null},"marketData":{"referencePrice":null,"high52W":"553.7200","low52W":"349.2000","volumeShares24H":"43328","avgDailyVolume1Y":null,"totalShares":null,"marketCap":"3697401866334.00","turnoverRate":null,"amplitude":null,"dividendYield":"0.00720000","latestDividend":"0.910000","peRatioTTM":"27.6400","pbRatio":"8.3600"}},"timestamp":1790337978945,"success":true}
```

- `statusInfo`: `openState` `true`, `reasonCode` `"TRADING"` (documented as "Others: TRADING (normal)"). `marketStatus` is `null`, although the schema describes it as one of premarket / regular / postmarket / overnight / closed / pause. `reasonMsg`, `nextOpenTime` and `nextCloseTime` are `null`.
- `marketData.referencePrice` is `null` here, while `/rwa/price` two seconds later returned one (below).

## 2026-09-25 12:06:19.056Z — RWA Data API: `GET /api/v1/dex/market/rwa/price`, MSFTB

- Query: `binanceChainId=56&tokenContractAddress=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0&tokenContractAddresses=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0` (the documented parameter is `tokenContractAddresses`; `tokenContractAddress` was sent by mistake as well).
- HTTP status: `200`. Total time: 0.98 s.
- Response, verbatim:

```json
{"code":0,"msg":"success","data":[{"binanceChainId":"56","tokenContractAddress":"0x80106cb3ead06659a5ad19df39d9b4733863b9b0","platformId":"bstock","tokenPrice":"497.09000000","referencePrice":"496.437698","tokenPriceUpdatedAt":1790337979652}],"timestamp":1790337980345,"success":true}
```

- `referencePrice / tokenPrice` = 496.437698 / 497.09 = 0.99869. The schema describes `referencePrice` as "A per-share converted price derived from the on-chain token price, not an official quote from the traditional stock market." Not used as an independent price anywhere in the app.

## 2026-09-25 12:29 – 12:37 UTC — App runtime: RWA market status every tick; first `referencePriceCheck` pass

- Production build with `marketStatusCheck`; direct home connection (`loc=NG`). Each scheduler tick now makes two Binance calls in parallel: `GET /api/v1/dex/aggregator/quote` and `GET /api/v1/dex/market/rwa/underlying-market?binanceChainId=56&tokenContractAddress=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0`.
- 12:29:38 – 12:34:45 UTC: every call in every tick, both endpoints, `TimeoutError: The operation was aborted due to timeout` (10 s). curl at the same time: 12:30:31 TCP connect 0.10 s, no TLS handshake within 19.3 s; 12:30:54 and 12:31:22, nothing within 25 s. Market status recorded as `unavailable` on those ticks.
- 12:36:35 UTC onward, both endpoints ok:

| Call start (UTC) | Endpoint | HTTP | Latency ms | Code |
|---|---|---|---|---|
| 12:36:35.984 | aggregator/quote | 200 | 1466 | 0 |
| 12:36:35.986 | rwa/underlying-market | 200 | 1448 | 0 |
| 12:36:55.957 | aggregator/quote (manual instruction, 200 USDT) | 200 | 960 | 0 |
| 12:36:55.960 | rwa/underlying-market (manual instruction) | 200 | 874 | 0 |
| 12:37:07.365 | aggregator/quote | 200 | 2883 | 0 |
| 12:37:07.367 | rwa/underlying-market | 200 | 2879 | 0 |

- `statusInfo` parsed from every successful underlying-market call: `openState: true, reasonCode: "TRADING", marketStatus: null, reasonMsg: null, nextOpenTime: null, nextCloseTime: null` (same as the first call at 12:06).
- Manual instruction `POST /api/instruction {"instruction":"Buy $200 of MSFT"}`, HTTP 200 in 4.51 s → ledger `ledger_1790339816918_11` (12:36:56.918Z), mode `simulation`, outcome `no_edge`, verdict approved:
  - `marketStatus` ok (TRADING).
  - `referencePrice` ok: buy-leg pool (1% pool) spot $497.0159 vs Binance quote $499.3230 (LiquidMesh, `Rfq Neptunex`), 0.462% apart; limit 2%.
  - `dryRunFloor` pending. Net edge −0.949%: nothing sent.

## 2026-09-25 13:23:30 – 13:24:32 UTC — First live execution on BSC mainnet: $5 MSFTB round trip (execution test)

Run by the user: killswitch set to `live`, `POST /api/execution-test {"sizeUsd":5,"confirm":true}`, killswitch back to `simulation`. Production build, direct home connection. Trading wallet `0x0bA556a253D2f1FdCF352aD55A5b44718802BB95`, 0.25% MSFTB/USDT pool `0x5018b018ceb7645c927c5cf246786f89ebcbe7ea`, PancakeSwap V3 SwapRouter `0x1b81D678ffb9C0263b24A97847620C99d213eB14`.

**Health gate at start.** The last three calls in the app's call log before the run, all HTTP 200, code 0:

| Call start (UTC) | Endpoint | Latency ms |
|---|---|---|
| 13:22:40.560 | aggregator/quote | 2887 |
| 13:23:13.619 | aggregator/quote | 2502 |
| 13:23:13.628 | rwa/underlying-market | 2486 |

**Transaction API calls made by the run** (app call log; each HTTP 200, code 0):

| Call start (UTC) | Endpoint | For | Latency ms |
|---|---|---|---|
| 13:23:30.998 | `POST /api/v1/dex/pre-transaction/simulate` | USDT approve | 3367 |
| 13:23:38.746 | `POST /api/v1/dex/pre-transaction/broadcast-transaction` (`enableMevProtection: true`) | USDT approve | 8307 |
| 13:23:53.003 | simulate | buy swap | 5003 |
| 13:24:04.955 | broadcast-transaction | buy swap | 3567 |
| 13:24:14.623 | simulate | MSFTB approve | 697 |
| 13:24:20.857 | broadcast-transaction | MSFTB approve | 2926 |
| 13:24:25.456 | simulate | sell swap | 1087 |
| 13:24:30.302 | broadcast-transaction | sell swap | 1021 |

Whole run: first simulate 13:23:30.998 → ledger entry written 13:24:32.442 (61.4 s), including four receipt waits.

**Route response** (the route returns the ledger entry; verbatim):

```json
{"kind":"execution_test","id":"ledger_1790342672442_26","timestamp":1790342672442,"action":"round_trip","mode":"live","sizeUsd":5,"pool":{"address":"0x5018b018ceb7645c927c5cf246786f89ebcbe7ea","feeUnits":2500},"outcome":"completed","legs":[{"side":"buy","tokenIn":"0x55d398326f99059fF775485246999027B3197955","tokenOut":"0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0","amountIn":"5000000000000000000","approval":{"needed":true,"txId":"0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7"},"quotedAmountOut":"9987029532613962","amountOutMinimum":"9982036017847656","txId":"0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe","transactionSimulation":{"result":"succeeded","status":"SUCCESS","balanceChanges":[{"contractAddress":"0x55d398326f99059fF775485246999027B3197955","tokenType":"Erc20","change":"-5000000000000000000","owner":"0x0ba556a253d2f1fdcf352ad55a5b44718802bb95"},{"contractAddress":"0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0","tokenType":"Erc20","change":"9987029532613962","owner":"0x0ba556a253d2f1fdcf352ad55a5b44718802bb95"}],"allowanceChanges":[{"tokenAddress":"0x55d398326f99059ff775485246999027b3197955","owner":"0x0ba556a253d2f1fdcf352ad55a5b44718802bb95","spender":"0x1b81d678ffb9c0263b24a97847620c99d213eb14","preAmount":"5000000000000000000","postAmount":"0"}]},"received":"9987029532613962"},{"side":"sell","tokenIn":"0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0","tokenOut":"0x55d398326f99059fF775485246999027B3197955","amountIn":"9987029532613962","approval":{"needed":true,"txId":"0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493"},"quotedAmountOut":"4975031264553765393","amountOutMinimum":"4972543748921488511","txId":"0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff","transactionSimulation":{"result":"succeeded","status":"SUCCESS","balanceChanges":[{"contractAddress":"0x55d398326f99059fF775485246999027B3197955","tokenType":"Erc20","change":"4975031264553765393","owner":"0x0ba556a253d2f1fdcf352ad55a5b44718802bb95"},{"contractAddress":"0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0","tokenType":"Erc20","change":"-9987029532613962","owner":"0x0ba556a253d2f1fdcf352ad55a5b44718802bb95"}],"allowanceChanges":[]},"received":"4975031264553765393"}],"spendRecordedUsd":9.987505836103352,"targetBalanceAfter":"0"}
```

**On-chain verification** (read through `BSC_RPC_URL` = `bsc-dataseed.bnbchain.org` at ~13:34 UTC):

| Tx | Hash | Status | Block (time UTC) | Nonce | Gas limit | Gas used | Gas price | Fee (BNB) |
|---|---|---|---|---|---|---|---|---|
| USDT approve | `0x9df5a668e25b2b7f329a8b4a4200bfe85d98aed878bde8c3ed1d73d2449e62e7` | success | 123956296 (13:23:42) | 0 | 46,576 | 46,194 | 0.05 gwei | 0.0000023097 |
| buy swap | `0x66aa49fdcd676cfc1df23c717bf7530aa5cdf8267255dfb2bc2bfefa40b9c5fe` | success | 123956355 (13:24:08) | 1 | 213,656 | 195,618 | 0.05 gwei | 0.0000097809 |
| MSFTB approve | `0xa3dc00ab5312623e223965e25baf2944cd07decbff1f2f6d64527c42dd3e0493` | success | 123956388 (13:24:23) | 2 | 55,231 | 54,432 | 0.05 gwei | 0.0000027216 |
| sell swap | `0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff` | success | 123956404 (13:24:31) | 3 | 219,305 | 201,179 | 0.05 gwei | 0.00001005895 |
| **Total** | | | | | | **497,423** | | **0.00002487115** |

- All four are type-2 (EIP-1559) transactions with `maxFeePerGas` = `maxPriorityFeePerGas` = 0.05 gwei; block `baseFeePerGas` 0. The gas price was set locally from the RPC (`prepareTransactionRequest`); Binance's MEV-protected broadcast accepted it (HTTP 200, code 0, txHash returned) and each was included at exactly 0.05 gwei. Each block timestamp falls within the broadcast call's own response time (e.g. USDT approve: broadcast started 13:23:38.746, took 8,307 ms; mined in the 13:23:42 block).
- Private-mempool routing itself is not observable on-chain; what is verified is that Binance accepted the `enableMevProtection: true` broadcasts and the transactions were mined. The app does not yet store the broadcast's `orderId` on the ledger entry.
- Pre-run gas estimate (2026-09-25 05:54, state-override `eth_estimateGas`): 534,815. Actual: 497,423.
- Wallet nonce after the run: 4 — these four are the only transactions the wallet has sent.
- Amounts: QuoterV2's `quotedAmountOut` equals the amount received on both legs (9,987,029,532,613,962 MSFTB units; 4,975,031,264,553,765,393 USDT units), and so do the swap simulations' `balanceChanges`.
- Balances (latest block 123957446): BNB 0.00290496885 (0.00292984 − 0.00002487115, exact), USDT 4.975031264553765393 (−0.024968735446234607 USDT: the two 0.25% pool fees and price impact), MSFTB 0. `/api/status` `walletBalances` shows the same.

**Allowances after the run.** `allowance(wallet, SwapRouter)` at block 123957446: USDT `0`, MSFTB `0`. Historical `eth_call` at the approve/sell blocks: `Missing or invalid parameters.` (the RPC keeps no historical state).

**Why the sell swap's simulation reported no MSFTB allowance change.**
- The MSFTB approve emitted `Approval(wallet, SwapRouter, 9987029532613962)`. The sell swap spent exactly 9,987,029,532,613,962 and the allowance is now 0: the approval was fully consumed. No approval was left behind.
- Buy swap logs include USDT's `Approval(wallet, SwapRouter, 0)`, emitted by USDT's `transferFrom`; the buy swap's simulation reported `allowanceChanges` 5e18 → 0.
- Sell swap logs have no `Approval` event from MSFTB (only `Transfer` and one other MSFTB event, topic0 `0x0226a2f5…`). MSFTB's storage uses OpenZeppelin v5's namespaced ERC20 layout (found 2026-09-25, storage-slot probe), and OZ v5 does not emit `Approval` when `transferFrom` spends an allowance.
- So the simulation omitted a change that did happen. Inferred: `allowanceChanges` is derived from `Approval` events. Not confirmed from Binance's docs.

## 2026-09-25 20:21:13 UTC — First Binance calls from the hosted deployment (Railway, Singapore)

- Deployment: Railway, `basis-production-c229.up.railway.app`, set up in the dashboard per `docs/railway-dashboard-checklist.md`. Serving zone reported by Railway (`X-Railway-Debug: 1` → `x-railway-upstream-zone`): `railway/asia-southeast1-eqsg3a`. `PUBLIC_READ_ONLY=true`, no trading key.
- First call (the hosted server's own call log, `/api/status`): `GET /api/v1/dex/market/rwa/underlying-market?binanceChainId=56&tokenContractAddress=0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0`, started 20:21:13.835Z, HTTP 200, code 0, 117 ms. Same tick: `GET /api/v1/dex/aggregator/quote` (200 USDT → MSFTB, `userWalletAddress=0x0bA556a253D2f1FdCF352aD55A5b44718802BB95`), started 20:21:13.833Z, HTTP 200, code 0, 121 ms.
- First 14 calls, 20:21:13 – 20:24:13 UTC (7 ticks × quote + underlying-market): 14 ok, 0 failed; latency p50 121 ms, p95 147 ms, max 147 ms, min 109 ms. No `40301`–`40304`. (From the home connection on the same day: 0.9–9.9 s per call when reachable.)
- Reference quotes recorded on the first 9 detection entries: $517.7496 – $518.7200 (`Rfq Neptunex` ×7, `Rfq Neptune` ×1, `Pancakeswap V3` ×1); 1% pool $514.8746, 0.25% pool $517.3816; quote 0.56–0.75% above the cheaper pool. `statusInfo` on every tick: `openState: true, reasonCode: "TRADING"`, other fields null.
