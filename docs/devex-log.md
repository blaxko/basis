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
