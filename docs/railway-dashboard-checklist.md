# Railway dashboard checklist (public, read-only deployment)

In the order you meet each screen on railway.com. Labels are from Railway's docs, checked 2026-09-25. Background and post-deploy checks: [`pre-flight-notes.md`](pre-flight-notes.md#deploying-to-railway-public-read-only).

**Before you start**

- [ ] No local Basis server is running. Never run a local server and the hosted one against Binance at the same time (Binance error `40303`).
- [ ] Plan: **Hobby**. A Limited (unverified) Trial restricts outbound network access; the app needs Binance and the BSC RPC.

**1. Workspace Settings** (railway.com/workspace)

- [ ] Preferred region: **Southeast Asia (Singapore)**. New services deploy here by default. Railway's other regions (US West, US East, EU West = Amsterdam) are all on Binance's restricted list.

**2. Dashboard → New Project → GitHub repo**

- [ ] Repository: **`blaxko/basis`**.
- [ ] Click **Add variables**, **not** Deploy Now. Deploy Now starts building immediately, before the settings below exist.

**3. Service → Variables tab**

- [ ] **Ignore the suggested variables.** Railway offers to import names from `.env.example`, which include `TRADING_WALLET_PRIVATE_KEY`.
- [ ] Add exactly these seven (**New Variable**, or paste into the **RAW Editor**):

  ```
  PUBLIC_READ_ONLY=true
  TRADING_WALLET_ADDRESS=0x0bA556a253D2f1FdCF352aD55A5b44718802BB95
  BINANCE_WEB3_API_BASE_URL=https://web3.binance.com/build
  BINANCE_WEB3_API_KEY=
  BINANCE_WEB3_API_SECRET=
  GROQ_API_KEY=
  BSC_RPC_URL=
  ```

- [ ] Fill the last four from your `.env.local` before saving. No quotes, no spaces around `=`.
- [ ] **Never add `TRADING_WALLET_PRIVATE_KEY`.** Don't add `PORT` either: Railway injects it and `next start` reads it.

**4. Service → Settings**

- [ ] **Scale → Regions**: **Southeast Asia (Singapore)**, **1** replica. No other region listed.
- [ ] **Build → Custom Build Command**: `npm run build`
- [ ] **Deploy → Custom Start Command**: `npx next start -H 0.0.0.0`
- [ ] **Deploy → Healthcheck Path**: `/api/health`
- [ ] **Deploy → Serverless**: **off** ("Enable Serverless" not toggled). It's off by default; a sleeping service would stop the 30 s scheduler.

**5. Canvas → Deploy** (top of the canvas)

- [ ] Review the staged changes: the variables and settings above, nothing else. Then deploy.
- [ ] Wait for the deployment to show success. The healthcheck must return 2xx within 300 s by default.

**6. Service → Settings → Networking → Public Networking → Generate Domain**

- [ ] Click **Generate Domain**. The app listens on one port, so Railway detects the target port itself. You get a `*.up.railway.app` domain.

**7. Right after the first deploy**

- [ ] Run the five post-deploy checks in [`pre-flight-notes.md`](pre-flight-notes.md#deploying-to-railway-public-read-only): read-only 403s, serving zone, one logged Binance call, the `X-Real-IP` spoof test, Serverless off.
- [ ] If any Binance call returns `40301`, `40302`, `40303` or `40304`: stop. Service → Deployments → the deployment's menu → **Remove**. Don't retry.

Reference only: [`.railway/railway.ts`](../.railway/railway.ts) records the same settings as code. It is **not applied** by this dashboard setup; see the README.
