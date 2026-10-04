// The words of the four pages behind the landing page's menu: How it
// works, Guardrails, Findings and FAQ. Each page is a short explanation, not
// a document: a heading that makes a claim, then a sentence or two, in cards
// and short lists. Detail that doesn't fit here is in the README. Every fact
// is already in the repo (the code, lib/guardrails/config.ts, docs/PRD.md,
// docs/config-rationale.md, README.md); the only time-sensitive figures are
// in components/finding-facts.ts, and every claim that could become false is
// dated there. Server-only text: no page here ships JavaScript of its own.
// test/site-pages.test.ts checks the numbers against the config and the
// rules (no profit claims, no brand marks, nothing about the execution run).

import { LANDING } from "./landing-content";
import { FINDING_FACTS, ROUND_TRIPS_TITLE } from "./finding-facts";

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
    description: "Real prices tested ideas for a trade worth making and rejected them. Each finding, with its data period, how it was measured and why it matters.",
  },
  faq: {
    path: "/faq",
    menu: "FAQ",
    title: "Questions and answers · Basis",
    description: "Straight answers about Basis: what it is for, whether it makes money, what happens if an edge appears, what the demo can and can't do, and how the AI is used.",
  },
};

// --- How it works ----------------------------------------------------------

export const HOW = {
  title: "Every 30 seconds, three steps.",
  lede: "Basis reads two pools, takes every cost off the gap between them, and goes further only if something is left.",
  steps: [
    {
      name: "Read",
      title: "Prices come straight from the chain.",
      body: "Both pools' prices and liquidity come from BNB Chain, with a Binance quote as a cross-check. Aggregators are skipped: they are built to erase the gap.",
    },
    {
      name: "Count",
      title: "Every cost comes off the gap.",
      body: "The two pools' fees, 0.25% and 1%, take 1.25% before anything else. Slippage (a flat 0.05%) and live gas with a 2× margin come off too; what is left is the net edge.",
    },
    {
      name: "Guard",
      title: "Six checks decide, and one failure blocks.",
      body: "An order is built only above a 0.01% net edge, then the guardrails check it. The public site only simulates: it holds no wallet key and refuses live mode.",
    },
  ],
  formula: LANDING.how.formula,
  example: {
    title: "A worked example, from the live reading.",
    intro: "The latest recorded reading, laid out as the formula.",
  },
  apisTitle: "Which Binance Web3 API modules do what.",
  apis: [
    {
      title: "Trading API",
      body: "aggregator/quote is the reference price each pool is checked against. Runs on the public site.",
    },
    {
      title: "RWA Data API",
      body: "rwa/underlying-market says whether the stock is trading; rwa/price confirms each token's issuer. Runs on the public site.",
    },
    {
      title: "Transaction API",
      body: "pre-transaction/simulate and broadcast-transaction test a trade and send it with MEV protection. The public site never reaches it.",
    },
    {
      title: "Also",
      body: "BNB Chain RPC: pool prices and gas. Groq's openai/gpt-oss-120b only turns typed text into an order.",
    },
  ],
} as const;

// --- Guardrails ------------------------------------------------------------

// Each check: what it does, its limit, and what happens if it fails, in a
// sentence or two. The limits are lib/guardrails/config.ts's
// (test/site-pages.test.ts checks them).
export const GUARDRAILS = {
  title: "Six checks stand between an idea and a trade.",
  lede: "Fixed rules, not AI judgement. One failure blocks the order.",
  checks: [
    {
      name: "Per-trade cap",
      title: "No order may be over $500.",
      body: "Caps one order at $500. A larger one is blocked, not reduced.",
    },
    {
      name: "Daily cap",
      title: "No more than $2,000 goes out a day.",
      body: "Adds this order to everything sent today (UTC). Over $2,000, it is blocked.",
    },
    {
      name: "Reference price",
      title: "Pool prices are checked against Binance.",
      body: "The buy pool must be within 2% of Binance's quote for the same trade. Too far apart, or no quote at all, blocks the order.",
    },
    {
      name: "Market status",
      title: "A paused or unknown market blocks trading.",
      body: "Passes on TRADING and MARKET_CLOSED, so a closed stock market doesn't stop it. ASSET_PAUSED, ASSET_LIMITED, UNSUPPORTED, MARKET_MAINTENANCE, MARKET_PAUSED, or a status that is unknown or can't be fetched, blocks.",
    },
    {
      name: "Price sanity and liquidity",
      title: "Both pools must look sane.",
      body: 'Each price within 5% of its recent median (at least 10 readings), and at least $1,000 in the thinner pool. With fewer than 10 readings the gate shows "warming up"; any failure blocks.',
    },
    {
      name: "Dry-run floor",
      title: "A simulated trade must return enough.",
      body: 'The simulation must return at least 98% of the order. Until one exists the check shows "pending", never a pass, and it runs again before anything is sent.',
    },
  ],
  more: {
    title: "Two more checks run right before a send.",
    items: [
      {
        title: "Spread freshness",
        body: "Both pools are read again. The edge must still be positive and keep at least half of what was detected.",
      },
      {
        title: "Slippage tolerance",
        body: "The swap's 0.05% minimum-output margin must be below the expected edge, or the order is refused.",
      },
    ],
  },
  failing: {
    title: "Every decision is logged, and nothing is sent here.",
    body: 'A blocked order names its check, and every decision, including each "no", goes into the audit ledger. If the gate itself errors, it blocks. The public demo can\'t send at all: it holds no wallet key and refuses live mode.',
  },
} as const;

// --- Findings --------------------------------------------------------------

const rt = FINDING_FACTS.roundTrips;
const rd = FINDING_FACTS.readings;

// Each finding: the claim, its data period, and a sentence or two on how it
// was measured and why it matters. A claim about the readings carries the
// date it holds up to (CHECKED_UNTIL), so it stays true after the freeze.
export const FINDINGS = {
  title: "Real data said no.",
  lede: "Each idea below was tested with real prices and rejected.",
  findings: [
    {
      title: ROUND_TRIPS_TITLE,
      period: rt.period,
      body: `A read-only recorder compared $200 quotes of Microsoft's token from both issuers every 30 seconds, per share, with both quotes at most 60 seconds old. The best round trip was ${rt.best} and the median ${rt.median}, so there was nothing to trade across issuers.`,
      note: `${rd.valid.toLocaleString("en-US")} of ${rd.total.toLocaleString("en-US")} readings were valid, as of ${rd.asOf}: Binance's Ondo quote often fails or comes back absurd, and Basis rejects it. Not recorded: ${FINDING_FACTS.gaps}.`,
    },
    {
      title: "Dividend timing: the tokens moved together.",
      period: "20 Aug 2026",
      body: "On Microsoft's ex-dividend date, real bStocks and Ondo prices moved together, in the same direction and by a similar amount, while only the stock fell. With no issuer lagging, there was nothing to trade.",
    },
    {
      title: "Weekend gaps: there was no gap to trade.",
      period: "18–21 Sep 2026",
      body: "Friday to Monday, both instruments kept moving through the closed-market hours, with no gap and no freeze when the market reopened.",
    },
    {
      title: "Aggregators erase the gap, so Basis reads the pools.",
      period: "25 Sep 2026",
      body: "Binance's aggregator quoted the same $200 purchase 12 times in five minutes, each time by the best route, with implied prices up to $1.40 apart. Its job is to erase pool gaps, so only a direct pool read can see one.",
    },
    {
      title: "The 0.25% and 1% pools start 1.25% behind.",
      period: "25–30 Sep and 3–4 Oct 2026",
      body: "Buying pays one pool's fee and selling the other's, before slippage and gas. Net edge ran about −0.5% to −1.3%; on 3–4 Oct the gap widened to about 0.7–0.8%, still short of the 1.3% it costs.",
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

// Ten of the most useful questions, one or two sentences each. The rest of
// what used to be here (closed markets, the AI model, sell orders, who can
// change the mode, Ondo quotes) is in the README.
export const FAQ_PAGE = {
  title: "Straight answers.",
  lede: "What Basis is for, what it does, and what the demo can and can't do.",
  items: [
    landing("What is Basis for?"),
    { q: "What is a tokenized stock?", a: LANDING.tokenized.body },
    landing("Does Basis make money?"),
    {
      q: 'What does "net edge" mean?',
      a: "What is left of the gap between the two pools after both pools' fees, slippage and gas. Basis proposes a trade only above 0.01%.",
    },
    {
      q: "What happens if the net edge turns positive?",
      a: 'Basis builds a $200 order and runs the six guardrails on it. The public demo only simulates, so nothing is sent: the ledger shows "guardrails passed · not sent".',
    },
    landing("Can I trade on the demo?"),
    landing("Is the AI making trading decisions?"),
    landing("Why only Microsoft?"),
    {
      q: "Is anything kept after a restart?",
      a: "No: the audit ledger lives in memory and resets on restart. You can export the rows you see as a CSV file.",
    },
    { q: "Where is the code?", a: "On GitHub at github.com/blaxko/basis, under the MIT licence." },
  ],
} as const;
