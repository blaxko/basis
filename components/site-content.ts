// The words of the four pages behind the landing page's menu: How it
// works, Guardrails, Findings and FAQ. Each is the fuller version of its
// topic: short headings that are claims, short paragraphs, cards where they
// help. Every fact is already in the repo (the code, lib/guardrails/config.ts,
// docs/PRD.md section 5b, docs/config-rationale.md, README.md); the only
// time-sensitive figures are in components/finding-facts.ts. Server-only
// text: no page here ships JavaScript of its own.
// test/site-pages.test.ts checks the numbers against the config and the
// rules (no profit claims, no brand marks, nothing about the execution run).

import { LANDING } from "./landing-content";
import { FINDING_FACTS } from "./finding-facts";

export { FINDING_FACTS };

export type PageKey = "how-it-works" | "guardrails" | "findings" | "faq";

// Each page's address, menu name, and its own title and description for
// search results and link previews.
export const PAGES: Record<PageKey, { path: string; menu: string; title: string; description: string }> = {
  "how-it-works": {
    path: "/how-it-works",
    menu: "How it works",
    title: "How Basis works · Basis",
    description: "How Basis reads two PancakeSwap pools every 30 seconds, counts every cost of the gap, and stops unless a real edge is left. With a live worked example.",
  },
  guardrails: {
    path: "/guardrails",
    menu: "Guardrails",
    title: "The six guardrails · Basis",
    description: "The six checks every Basis order must pass: what each one measures, its real limit, and what happens when it fails. One failure blocks the trade.",
  },
  findings: {
    path: "/findings",
    menu: "Findings",
    title: "What the data said · Basis",
    description: "Real prices tested ideas for a trade worth making and rejected them. Each finding, with its data period, how it was measured and why it was rejected.",
  },
  faq: {
    path: "/faq",
    menu: "FAQ",
    title: "Questions and answers · Basis",
    description: "Straight answers about Basis: what it is for, whether it makes money, what the demo can and can't do, how the AI is used, and where the data comes from.",
  },
};

// --- How it works ----------------------------------------------------------

export const HOW = {
  title: "Every 30 seconds, three steps.",
  lede: "Basis reads two PancakeSwap pools, counts every cost of trading the gap between them, and only goes further when a real edge is left.",
  steps: [
    {
      name: "Read",
      title: "Both pools are read straight from the chain.",
      paragraphs: [
        "Every 30 seconds Basis asks each pool's contract for its current price and its liquidity, over a BNB Chain RPC node. It doesn't use an aggregator's price, because an aggregator is built to erase the gap Basis is looking for.",
        "It also estimates the gas for both swaps live, and asks Binance for a quote for the same purchase as a cross-check. The last 60 readings of each pool, about 30 minutes, are kept so a sudden jump stands out.",
      ],
    },
    {
      name: "Count",
      title: "Every cost comes off the gap.",
      paragraphs: [
        "The gap is the price difference between the two pools. Buying pays one pool's fee and selling pays the other's: 0.25% and 1%, which is 1.25% before anything else.",
        "Slippage, the price moving as the trade fills, is a flat 0.05% estimate taken from measured $200 trades. Gas is a live estimate with a 2× safety margin. What is left is the net edge.",
      ],
    },
    {
      name: "Guard",
      title: "Six checks, then a simulation.",
      paragraphs: [
        "An order is built only when the net edge is above 0.01%. Six guardrails then check it, and one failure blocks it.",
        "Before anything would be sent, Binance's Transaction API simulates the trade, the wallet signs it locally, and it is broadcast with MEV protection.",
        "The public site never reaches that last part: it holds no wallet key, and its server refuses live mode.",
      ],
    },
  ],
  formula: LANDING.how.formula,
  example: {
    title: "A worked example, from the live reading.",
    intro: "These are the numbers behind the latest reading, laid out as the formula.",
  },
  apisTitle: "Which Binance Web3 API modules are used where.",
  apis: [
    {
      title: "Trading API · aggregator/quote",
      body: "Gives the quote that the reference-price guardrail compares each pool against, and the buy and sell quotes the issuer monitor uses. It runs on the public site.",
    },
    {
      title: "RWA Data API · rwa/underlying-market and rwa/price",
      body: "underlying-market says whether Microsoft's stock is trading, for the market-status guardrail. price confirms which issuer a token belongs to and its share multiplier, for the issuer monitor. Both run on the public site.",
    },
    {
      title: "Transaction API · pre-transaction/simulate and broadcast-transaction",
      body: "Simulates a trade before it is sent and broadcasts it with MEV protection. This is the trading path, which the public site never reaches.",
    },
    {
      title: "Also: BNB Chain and Groq",
      body: "A BNB Chain RPC node supplies pool prices, liquidity and gas. Groq's model, openai/gpt-oss-120b, only reads typed instructions into a stock, a side and a dollar amount.",
    },
  ],
  apisNote: "Every Binance call is signed, and the dashboard's status strip shows how the latest one went.",
} as const;

// --- Guardrails ------------------------------------------------------------

export const GUARDRAILS = {
  title: "Six checks stand between an idea and a trade.",
  lede: "Each check is a fixed rule, not an AI judgement. Here is what each one measures, its limit, and what happens when it fails.",
  checks: [
    {
      name: "Per-trade cap",
      title: "No order may be over $500.",
      measures: "The size of the order.",
      limit: "$500 per trade.",
      fails: "The order is blocked, not reduced to fit.",
    },
    {
      name: "Daily cap",
      title: "No more than $2,000 goes out in a day.",
      measures: "Everything sent so far today, in UTC, plus this order.",
      limit: "$2,000 per UTC day.",
      fails: "The order is blocked, and the verdict shows the projected total.",
    },
    {
      name: "Reference price",
      title: "Pool prices are checked against Binance.",
      measures: "The buy pool's price against Binance's own quote for the same token and size.",
      limit: "The pool price must be within 2% of the quote.",
      fails: "The order is blocked. If Binance gives no quote at all, the check fails closed: no quote, no trade.",
    },
    {
      name: "Market status",
      title: "A paused or unknown market blocks trading.",
      measures: "The status Binance's RWA Data API reports for the underlying stock.",
      limit: "Passes on TRADING and MARKET_CLOSED. Blocks on ASSET_PAUSED, ASSET_LIMITED, UNSUPPORTED, MARKET_MAINTENANCE and MARKET_PAUSED.",
      fails: "The order is blocked, with Binance's own message shown. A status Basis doesn't know, or one that can't be fetched, blocks too. A closed market doesn't stop it: Basis may trade outside stock-market hours.",
    },
    {
      name: "Price sanity and liquidity",
      title: "Both pools must look sane.",
      measures: "Each pool's price against the median of its own recent readings, and how much the thinner pool holds.",
      limit: "Each price within 5% of its median, with at least 10 readings, and at least $1,000 in the thinner pool.",
      fails: 'The order is blocked. With fewer than 10 readings, about 5 minutes after a restart, the gate shows "warming up" and no order is proposed.',
    },
    {
      name: "Dry-run floor",
      title: "A simulated trade must return enough.",
      measures: "What a simulation says the trade would return, against the order's size.",
      limit: "At least 98% of the order's size.",
      fails: 'The order is blocked. Until a simulation exists the check shows "pending", never a pass, and it runs again on the real simulated output before anything is sent.',
    },
  ],
  more: {
    title: "Two more checks run right before a send.",
    items: [
      {
        title: "Spread freshness",
        body: "Both pools are read again just before sending. The edge must still be positive and keep at least half of what was detected, or the order is refused.",
      },
      {
        title: "Slippage tolerance",
        body: "The swap's minimum output is the simulated output less 0.05%. An order is refused when that tolerance isn't below its expected edge, because the floor couldn't protect it.",
      },
    ],
  },
  failing: {
    title: "A failure is recorded, never silent.",
    paragraphs: [
      'A failed check blocks the order and names the check that did it. The decision, including any "no", goes into the audit ledger.',
      "If the gate itself hits an error, it blocks: it fails safe.",
      "On the public demo nothing can be sent at all: it holds no wallet key, and its server refuses live mode.",
    ],
  },
} as const;

// --- Findings --------------------------------------------------------------

const rt = FINDING_FACTS.roundTrips;
const rd = FINDING_FACTS.readings;

export const FINDINGS = {
  title: "Real data said no.",
  lede: "Basis began as a search for a trade worth making. Each idea below was tested with real prices and rejected.",
  findings: [
    {
      title: `${rt.count} fresh round trips between bStocks and Ondo: none cleared costs`,
      period: rt.period,
      measured:
        "A read-only recorder asked Binance for $200 quotes of Microsoft's token from both issuers every 30 seconds, and compared them per share using each token's share multiplier. A round trip buys from one issuer and sells to the other, after fees, price impact and gas, with both quotes at most 60 seconds old.",
      showed: `Of ${rt.count} round trips, none was above zero. The best was ${rt.best} and the median ${rt.median}.`,
      why: "Even the closest pair left nothing after costs, so there is nothing to trade across issuers. The panel stays monitor-only: Basis doesn't trade across issuers.",
      notes: [
        `Data quality: ${rd.valid.toLocaleString("en-US")} of ${rd.total.toLocaleString("en-US")} readings were fully valid, as of ${rd.asOf}. Binance's Ondo quote often came back with an implausible price, about $1.03 billion per token, or failed when the market was closed. Basis rejects any quote more than 20% from bStocks per share and shows the reason.`,
        "xStocks is left out: Binance's RWA Data API returns its Microsoft token with no platform and a price last updated on 8 September, so it can't be confirmed as xStocks.",
        `Not recorded: ${FINDING_FACTS.gaps}. The recorder keeps its readings in memory only, and these stretches were lost.`,
      ],
    },
    {
      title: "Dividend timing: tested with real prices, rejected",
      period: "20 Aug 2026",
      measured:
        "Microsoft's real ex-dividend date was checked against real bStocks and Ondo token prices at the time. The issuers' own pages were read too: xStocks and bStocks both describe a rebase that reinvests dividends into token balances.",
      showed: "The two tokens moved together, in the same direction and by a similar amount, while only the real stock dropped on the ex-dividend date.",
      why: "The idea needed one issuer's token to lag the dividend and open a gap. None did, so there was nothing to trade.",
      notes: [],
    },
    {
      title: "Weekend gaps: tested with real prices, rejected",
      period: "18–21 Sep 2026",
      measured: "A full Friday-to-Monday window was checked the same way, against real prices.",
      showed: "Both instruments moved continuously through the closed-market hours, with no gap and no freeze when the market reopened.",
      why: "A weekend gap needs one price to stand still while the other moves. Neither did, so there was nothing to trade.",
      notes: [],
    },
    {
      title: "The aggregator erases the gap, so Basis reads the pools.",
      period: "25 Sep 2026",
      measured:
        "Binance's aggregator was asked for the same $200 purchase of Microsoft's token every 30 seconds for about five minutes: 12 quotes, 05:06 to 05:11 UTC. It chose between a PancakeSwap V3 route and RFQ routes, and the implied price differed by up to $1.40.",
      showed: "Each quote came from whichever route was best at that moment.",
      why: "Aggregators exist to send every trade to the best price, which erases the gap between pools for ordinary users. Capturing it means reading the pools directly, so Basis does.",
      notes: [],
    },
    {
      title: "The 0.25% and 1% pools start 1.25% behind.",
      period: "25–30 Sep 2026",
      measured:
        "Each pool's price was adjusted for its side of the trade: buying pays that pool's fee and selling nets less by it. Slippage and gas come off after that. An early reading, before the live readings began, put the pools 0.71% apart ($3.56).",
      showed: "The 1% pool's own fee alone was bigger than that whole gap. Live readings on 25–30 Sep 2026 had a net edge of about −0.8% to −1.3%.",
      why: "A positive gap with a negative net edge is a trap, not a signal. On this pair, fees alone cost 1.25%.",
      notes: [],
    },
  ],
} as const;

// --- FAQ -------------------------------------------------------------------

// The landing page's questions, word for word: one source.
function landing(q: string): { q: string; a: string } {
  const f = LANDING.faq.find((x) => x.q === q);
  if (!f) throw new Error(`no landing FAQ entry "${q}"`);
  return { q: f.q, a: f.a };
}

export const FAQ_PAGE = {
  title: "Straight answers.",
  lede: "What Basis is for, how it decides, and what the demo can and can't do.",
  groups: [
    {
      title: "About Basis",
      items: [
        landing("What is Basis for?"),
        { q: "What is a tokenized stock?", a: LANDING.tokenized.body },
        landing("Does Basis make money?"),
        landing("Why only Microsoft?"),
      ],
    },
    {
      title: "How it decides",
      items: [
        {
          q: 'What does "net edge" mean?',
          a: "It is what is left of the gap between the two pools after both pools' fees, slippage and gas. Basis proposes a trade only when it is above 0.01%.",
        },
        { q: "How often does Basis check?", a: "Every 30 seconds. After a restart it needs 10 readings of each pool, about 5 minutes, before it will propose any order." },
        {
          q: "Why doesn't a closed stock market stop it?",
          a: "MSFTB trades on BNB Chain around the clock, so Basis may trade outside stock-market hours. Only a status of paused, limited, unsupported or in maintenance, or one it can't read, blocks trading.",
        },
        landing("Is the AI making trading decisions?"),
        {
          q: "Which AI model reads instructions?",
          a: "Groq's openai/gpt-oss-120b. It only turns your sentence into a stock, a side and a dollar amount; the guardrails and live data decide.",
        },
        {
          q: "Why are sell orders refused?",
          a: "Basis only evaluates buying the cheaper pool for now, so sell orders aren't supported. Two-sided arbitrage stays off until it's built and verified.",
        },
      ],
    },
    {
      title: "The demo and the data",
      items: [
        landing("Can I trade on the demo?"),
        {
          q: "Who can change the mode on the demo?",
          a: "Anyone: switching between simulation and dry-run is shared by every visitor, and it returns to simulation after 5 minutes. Live is locked on the public demo.",
        },
        {
          q: "Is anything kept after a restart?",
          a: "No. The audit ledger lives in memory and resets when the server restarts. On the dashboard you can export the rows you're looking at as a CSV file.",
        },
        {
          q: 'What does "no valid quote" mean for Ondo?',
          a: "Binance's quote for Ondo's token has often been unusable: the market was closed (Binance error 40367), or the price came back more than 20% from bStocks per share. Basis rejects it and shows the reason instead of a number.",
        },
        { q: "Where is the code?", a: "On GitHub at github.com/blaxko/basis, under the MIT licence." },
      ],
    },
  ],
} as const;
