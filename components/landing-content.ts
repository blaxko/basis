// The landing page's words, in one place: short claims as headings, one
// or two sentences under each, content in cards. Every fact and figure is
// already recorded in the repo (the README, docs/, lib/guardrails/config.ts);
// longer explanations live in the README, not here. No profit claims, no
// numbers shown as live unless fetched live, no brand marks, nothing about
// the execution run or its keys.
// test/landing-and-app.test.ts checks those rules.

import { GITHUB_URL } from "./links";

export { GITHUB_URL };

// The demo video. null until it is published: the page then says nothing
// about a video. `npm run set-demo-video` sets it, and a "Watch the demo"
// link appears.
export const DEMO_VIDEO_URL: string | null = null;

const primary = { label: "Open the dashboard", href: "/app" } as const;

export const LANDING = {
  hero: {
    title: "A price gap isn't a profit.",
    lede: "Basis watches Microsoft's token in two PancakeSwap pools every 30 seconds and only trades when the gap survives every cost.",
    primary,
    secondary: { label: "Read the code", href: GITHUB_URL },
    micro: "Public demo, read-only. No wallet, deposit or sign-up needed.",
    videoLabel: "Watch the demo",
  },
  // The strip under the hero: the rules, restated from the sections below.
  ticker: [
    "Both pools read every 30 s",
    "0.25% + 1% in fees to clear first",
    "Six guardrails, one failure blocks",
    "$500 per trade",
    "$2,000 per UTC day",
    "Dry run returns at least 98%",
    "Every decision logged, including \"no\"",
    "Public demo: read-only",
  ],
  problem: {
    title: "The gap is smaller than the cost.",
    cards: [
      { title: "The gap", body: "MSFTB trades in two PancakeSwap V3 pools on BNB Chain, and their prices drift apart." },
      { title: "The costs", body: "Buying in one and selling in the other pays 1.25% in fees alone, plus slippage and gas." },
      { title: "Basis counts every cost first", body: "It proposes a trade only if the gap is still positive after all of them." },
    ],
  },
  how: {
    title: "Three steps, every 30 seconds.",
    steps: [
      { title: "Read", body: "Both pools' price and liquidity, straight from the chain." },
      { title: "Count", body: "Both pools' fees, slippage and gas, taken off the gap." },
      { title: "Guard", body: "Six guardrails must pass; one failure blocks the trade." },
    ],
    formula: "net edge = gap − fees − slippage − gas",
  },
  guardrails: {
    title: "Six checks. One failure blocks.",
    cards: [
      { title: "Per-trade cap", limit: "$500 per trade" },
      { title: "Daily cap", limit: "$2,000 per UTC day" },
      { title: "Reference price", limit: "Within 2% of Binance's quote" },
      { title: "Market status", limit: "Paused, limited or unknown blocks; closed doesn't" },
      { title: "Price sanity and liquidity", limit: "Sane prices, $1,000+ in each pool" },
      { title: "Dry-run floor", limit: "98% simulation floor" },
    ],
  },
  findings: {
    title: "Real data said no.",
    cards: [
      {
        value: "114",
        label: "fresh round trips, bStocks and Ondo",
        period: "26–29 Sep 2026",
        body: "None cleared costs; the best was −0.013%. Monitor only: no trades across issuers.",
      },
      {
        value: "3",
        label: "issuers' tokens moved together",
        period: "20 Aug 2026",
        body: "The stock fell on its ex-dividend day; bStocks, xStocks and Ondo rose. Dividend timing: rejected.",
      },
      {
        value: "4",
        label: "days of the same moves",
        period: "18–21 Sep 2026",
        body: "Ondo's and bStocks' tokens moved together all weekend. Weekend gaps: rejected.",
      },
    ],
  },
  faqTitle: "Straight answers.",
  faq: [
    {
      q: "Does Basis make money?",
      a: "No. In every reading recorded so far, the gap between the pools has been smaller than the cost of trading it. Basis is built to recognise that and not trade.",
    },
    {
      q: "Can I trade on the demo?",
      a: "No. The public demo is read-only by design. You can watch it work and send instructions to see how the guardrails respond. No wallet, deposit or sign-up needed.",
    },
    { q: "Is the AI making trading decisions?", a: "No. The AI only turns your typed instruction into a structured order. Fixed rules decide." },
    {
      q: "Why only Microsoft?",
      a: "Basis only trades tokens whose pools it has verified on-chain. Adding a stock means finding and verifying its pools first; Basis won't guess.",
    },
  ],
  closing: { title: "A price gap isn't a profit.", cta: primary },
  footer: { name: "Basis · Built on BNB Chain" },
} as const;
