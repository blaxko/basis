// The landing page's words, in one place. Every fact and figure comes from
// basis-project-details.md (outside the repo, the single source of truth
// for this page) and follows its rules: no profit claims, no numbers
// shown as live unless fetched live, no brand marks, nothing about the
// execution run or its keys.
// test/landing-and-app.test.ts checks those rules.

export const GITHUB_URL = "https://github.com/blaxko/basis";

// The demo video. null until it is published; the page then says it's
// coming instead of showing a dead link. `npm run set-demo-video` sets it.
export const DEMO_VIDEO_URL: string | null = null;

export const LANDING = {
  hero: {
    title: "An arbitrage agent for tokenized stocks that knows when not to trade.",
    lede:
      "Basis reads MSFTB, a token that tracks Microsoft, in two PancakeSwap V3 pools on BNB Chain every 30 seconds. It only proposes a trade if the gap is still positive after both pools' fees, slippage and gas, and then six guardrails still have to pass.",
    primary: { label: "Open the dashboard", href: "/app" },
    secondary: { label: "Read the code", href: GITHUB_URL },
    micro: "Public demo, read-only. No wallet, deposit or sign-up needed.",
    videoLabel: "Demo video",
    videoPending: "Demo video coming soon",
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
    title: "A price gap isn't a profit.",
    body: [
      "Tokenized stocks are tokens that track real shares. MSFTB, a bStocks token, tracks Microsoft. It trades around the clock on BNB Chain in two PancakeSwap V3 pools: one charging a 0.25% fee, one charging 1%. Their prices drift apart.",
      "A naive bot sees the gap as free money: buy in the cheaper pool, sell in the dearer one. But that trade pays both pools' fees (1.25% together), plus slippage (the price moving as you trade) plus gas (the network fee). The gap is almost always smaller than that.",
      "When the gap doesn't survive the costs, Basis records \"no opportunity\" and does nothing. Every decision, including \"no\", is logged.",
    ],
  },
  how: {
    title: "Every 30 seconds, the same five steps.",
    steps: [
      { title: "Read both pools", body: "Price and liquidity, straight from the pool contracts over a BSC RPC node." },
      { title: "Count every cost", body: "Both pools' fees, slippage and gas, subtracted from the gross gap." },
      { title: "Stop unless the net edge is positive", body: "Otherwise: \"no opportunity\", no order built." },
      { title: "Pass six guardrails", body: "One failure blocks the trade." },
      {
        title: "Simulate, sign, send",
        body: "Binance's Transaction API simulates the trade, the wallet signs it locally, and it is broadcast through Binance with MEV protection. The public site never reaches this step: it holds no wallet key.",
      },
    ],
    instructions:
      "You can type \"Buy $200 of MSFT\". An AI model (Groq, openai/gpt-oss-120b) only turns the text into a structured order. The guardrails decide. Non-English instructions also work.",
  },
  guardrailsTitle: "Six checks between an idea and a trade.",
  guardrails: [
    {
      check: "Price sanity and liquidity",
      does: "Prices must look sane against recent readings; each pool must hold enough liquidity. No order is proposed until 10 readings exist (about 5 minutes after a restart).",
      limit: "Minimum pool liquidity $1,000",
    },
    {
      check: "Market status",
      does: "Asks Binance's RWA Data API for the stock's status. Blocks if the asset is paused, limited, unsupported or in maintenance, if the code is unknown, or if the status can't be fetched. A plain \"market closed\" does not block: trading through closed hours is the point.",
      limit: "—",
    },
    { check: "Reference price", does: "The pool price must be close to Binance's own quote for the same trade. No quote available means no trade.", limit: "Within 2%" },
    { check: "Per-trade cap", does: "Larger orders are blocked, not reduced.", limit: "$500" },
    { check: "Daily cap", does: "Total sent per UTC day.", limit: "$2,000" },
    { check: "Dry-run floor", does: "The simulated trade must return enough of its value.", limit: "At least 98%" },
  ],
  guardrailsNote:
    "Also: the on-chain slippage tolerance is 0.05%, and the expected edge must exceed it. Right before sending, both pools are read again; if the edge has decayed or flipped, the trade is refused.",
  findings: {
    title: "What was tested, and rejected.",
    items: [
      {
        tag: "Rejected",
        title: "Dividend timing",
        body: "On Microsoft's ex-dividend day (20 Aug 2026) the real stock fell, but the bStocks, xStocks and Ondo tokens all rose together by a similar amount. No issuer behaved differently to trade against.",
      },
      { tag: "Rejected", title: "Weekend gaps", body: "Over the weekend of 18–21 Sep 2026, Ondo's and bStocks' Microsoft tokens kept moving together, day by day." },
      {
        tag: "Finding",
        title: "The aggregator erases the gap",
        body: "Binance's aggregator routes each trade to the best price, which erases the gap between pools. So Basis reads the pools directly.",
      },
      {
        tag: "Finding",
        title: "The pool pair starts 1.25% behind",
        body: "The 0.25% vs 1% pairing starts 1.25% behind before slippage and gas; no reading so far has cleared it.",
      },
    ],
  },
  issuers: {
    title: "Across issuers: monitor only.",
    label: "Monitor only: Basis doesn't trade across issuers",
    body: "Basis also compares Microsoft's token from bStocks (MSFTB) and Ondo (MSFTon) on BSC, per share, using each token's share multiplier (1.0013140 and 1.0057309, matching each issuer's published figures).",
    facts: [
      {
        label: "Round trips on fresh quotes",
        value: "104",
        body: "Both quotes at most 60 s old, recorded to 28 Sep 2026, 20:15 UTC. None cleared costs (best −0.013%, median −0.20%).",
      },
      {
        label: "Fully valid readings",
        value: "498 of 5,780",
        body: "As of 28 Sep 2026. Binance's Ondo quote repeatedly returned an implausible price (about $1.03 billion per token). Basis shows \"no valid quote\" with the reason instead of using a bad price.",
      },
      { label: "xStocks", value: "Excluded", body: "Binance's RWA Data API returns its MSFT token with no platform and a price stamped 8 September." },
    ],
  },
  limits: {
    title: "What it won't do.",
    items: [
      "No two-sided arbitrage. That stays off until it's built and verified.",
      "No trading from the public demo: it holds no wallet key, and the server refuses live mode.",
      "No guessing: one stock (Microsoft), one exchange (PancakeSwap V3), two pools.",
      "No lasting history: the audit log lives in memory and resets on restart.",
    ],
    next: "Next steps: two-sided execution, more verified tokens and pools, persistence for the audit log, and better handling of issuers whose quotes stop outside US market hours.",
  },
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
  footer: { name: "Basis · Built on BNB Chain", risk: "Not financial advice. Tokenized stocks and on-chain trading carry risk." },
} as const;
