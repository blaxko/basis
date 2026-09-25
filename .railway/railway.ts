// Railway Infrastructure as Code for the PUBLIC, read-only deployment.
// Nothing is created by committing this file: Railway doesn't read
// .railway/ during deploys. It takes effect only when someone runs
// `railway config plan` (read-only preview) and `railway config apply`
// from a linked checkout (docs.railway.com/infrastructure-as-code).
// Config as Code (railway.json / railway.toml) is deprecated and new
// services can't opt into it, so it isn't used.
//
// Region: Binance Web3 API refuses restricted locations
// (web3.binance.com/en/dev-docs/web3-api-prohibited-regions). Railway's
// regions (docs.railway.com/deployments/regions) are us-west2 (California)
// and us-east4-eqdc4a (Virginia) — US, restricted — europe-west4-drams3a
// (Amsterdam) — Netherlands, restricted — and asia-southeast1-eqsg3a
// (Singapore). Without explicit placement Railway uses the account's
// preferred region, so the region is pinned here, with exactly one
// replica: the 30 s scheduler runs in-process and the ledger, killswitch
// and spend tracker live in memory.
//
// Serverless (app sleeping) has no field here; it is off unless toggled
// on in the service's Settings > Deploy > Serverless, and must stay off
// (docs.railway.com/deployments/serverless). The scheduler's outbound
// calls every 30 s would keep it awake anyway.
//
// The trading key is deliberately absent: with PUBLIC_READ_ONLY=true the
// server never reads it. Never add TRADING_WALLET_PRIVATE_KEY here or in
// the Railway dashboard.
import { defineRailway, github, preserve, project, service } from "railway/iac";

const SINGAPORE = "asia-southeast1-eqsg3a";

export default defineRailway(() => {
  const web = service("basis", {
    source: github("blaxko/basis", { branch: "main" }),
    // Railpack installs dependencies first; `next start` reads Railway's
    // PORT and binds 0.0.0.0 by default (next 15.5 CLI), stated explicitly.
    build: "npm run build",
    start: "npx next start -H 0.0.0.0",
    healthcheck: "/api/health",
    replicas: { [SINGAPORE]: 1 },
    env: {
      PUBLIC_READ_ONLY: "true",
      TRADING_WALLET_ADDRESS: "0x0bA556a253D2f1FdCF352aD55A5b44718802BB95",
      BINANCE_WEB3_API_BASE_URL: "https://web3.binance.com/build",
      // Secrets: set in the Railway dashboard (Variables); preserve() keeps
      // whatever value is set there and never writes one into this file.
      BINANCE_WEB3_API_KEY: preserve(),
      BINANCE_WEB3_API_SECRET: preserve(),
      GROQ_API_KEY: preserve(),
      BSC_RPC_URL: preserve(),
    },
  });

  return project("basis", { resources: [web] });
});
