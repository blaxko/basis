// The landing page's words, in one place: short claims as headings and
// one full sentence per card, so someone who has never heard of Basis can
// follow it. Every fact and figure is already recorded in the repo (the
// README, docs/, lib/guardrails/config.ts); longer explanations live in
// the README. No profit claims, no numbers shown as live unless fetched
// live, no brand marks, nothing about the execution run or its keys.
// test/landing-and-app.test.ts checks those rules.

import { GITHUB_URL } from "./links";
import { FINDING_FACTS } from "./finding-facts";

export { GITHUB_URL };

// The demo video. null until it is published: the page then says nothing
// about a video. `npm run set-demo-video` sets it, and a "Watch the demo"
// link appears.
export const DEMO_VIDEO_URL: string | null = null;

const primary = { label: "Open the dashboard", href: "/app" } as const;

export const LANDING = {
  hero: {
    eyebrow: "An arbitrage agent for tokenized stocks on BNB Chain",
    title: "A price gap isn't a profit.",
    lede: [
      "Basis watches Microsoft's tokenized stock (MSFTB) in two PancakeSwap pools, counts every cost of trading the gap between them, and only trades when a real edge is left.",
      "Every decision, including \"no\", is logged.",
    ],
    primary,
    secondary: { label: "Read the code", href: GITHUB_URL },
    micro: "Public demo, read-only. No wallet, deposit or sign-up needed.",
    videoLabel: "Watch the demo",
  },
  tokenized: {
    title: "A token that tracks a real share.",
    body: "A tokenized stock is a token whose price follows a real company's share. MSFTB, issued by bStocks, tracks Microsoft and trades around the clock on BNB Chain.",
  },
  problem: {
    title: "The gap is smaller than the cost.",
    cards: [
      { title: "The gap", body: "MSFTB trades in two PancakeSwap V3 pools on BNB Chain, and their prices drift apart." },
      { title: "The costs", body: "Buying in one pool and selling in the other pays 1.25% in pool fees alone, plus slippage and gas." },
      { title: "Basis counts every cost first", body: "It subtracts all of those costs before it proposes a trade, so a gap that can't pay for itself is a firm no." },
    ],
  },
  how: {
    title: "Three steps, every 30 seconds.",
    steps: [
      { title: "Read", body: "Basis reads both pools' prices and liquidity straight from the chain." },
      { title: "Count", body: "It takes both pools' fees, slippage and gas off the gap." },
      { title: "Guard", body: "Six guardrails must all pass, and a single failure blocks the trade." },
    ],
    formula: "net edge = gap − fees − slippage − gas",
  },
  tryIt: {
    title: "Try it in the dashboard.",
    cards: [
      { title: "Watch the live spread", href: "/app#spread", body: "See both pool prices, the gap and the net edge update every 30 seconds." },
      { title: "Give an instruction", href: "/app#instruction", body: "Type an order, like \"Buy $200 of MSFT\", in plain English or other languages." },
      { title: "See the guardrails decide", href: "/app#gate", body: "Watch the six checks run on your order, with what each one measured." },
      { title: "Read the audit ledger", href: "/app#ledger", body: "Every decision is recorded, including each \"no\", and you can export it as CSV." },
    ],
  },
  guardrails: {
    title: "Six checks. One failure blocks.",
    cards: [
      { title: "Per-trade cap", body: "An order over $500 is blocked, not reduced." },
      { title: "Daily cap", body: "Trading stops once $2,000 has been sent in a UTC day." },
      { title: "Reference price", body: "The pool price must be within 2% of Binance's own quote for the same trade." },
      { title: "Market status", body: "Trading stops if Binance reports the stock paused, limited or unknown; a closed market doesn't stop it." },
      { title: "Price sanity and liquidity", body: "Prices must look sane against recent readings, and each pool must hold at least $1,000." },
      { title: "Dry-run floor", body: "A simulated trade must return at least 98% of its value before anything is sent." },
    ],
  },
  findings: {
    title: "Real data said no.",
    cards: [
      {
        // The recounted figures, shared with the Findings page.
        title: `${FINDING_FACTS.roundTrips.count} fresh round trips between bStocks and Ondo: none cleared costs`,
        period: FINDING_FACTS.roundTrips.period,
        body: `Microsoft's token from the two issuers, compared per share with both quotes at most 60 seconds old, never differed by enough to pay for the trade; the best was ${FINDING_FACTS.roundTrips.best}.`,
      },
      {
        title: "Dividend timing: tested with real prices, rejected",
        period: "20 Aug 2026",
        body: "On Microsoft's ex-dividend day the stock fell, but the bStocks and Ondo tokens moved together, in the same direction, so no issuer lagged to trade against.",
      },
      {
        title: "Weekend gaps: tested with real prices, rejected",
        period: "18–21 Sep 2026",
        body: "Over a weekend, Ondo's and bStocks' Microsoft tokens kept moving together day by day, leaving no gap to trade.",
      },
    ],
  },
  builtWith: {
    title: "Built with",
    items: [
      "BNB Chain",
      "PancakeSwap V3",
      "Binance Web3 API (Trading, Transaction and RWA Data modules)",
      "Groq, for reading typed instructions",
    ],
  },
  faqTitle: "Straight answers.",
  faq: [
    {
      q: "What is Basis for?",
      a: "It checks whether the gap between two pools of a tokenized stock is ever worth trading once every cost is counted, and it refuses the trade when it isn't, showing why.",
    },
    {
      q: "Does Basis make money?",
      a: "No. In every reading we have checked, the gap between the pools has been smaller than the cost of trading it. Basis is built to recognise that and not trade.",
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
