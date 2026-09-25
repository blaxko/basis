// Wording for the dismissible "Start here" panel on the public demo, for
// judges seeing Basis for the first time. Plain data so it can be tested
// and edited in one place.
import { LIVE_PROOF_TXS, bscScanTxUrl } from "./read-only-note";

// The demo video. null until it is published; the panel then says it's
// coming instead of showing a dead link. Set the URL here.
export const DEMO_VIDEO_URL: string | null = null;

// Per-visitor memory of "dismissed" (browser localStorage).
export const START_HERE_STORAGE_KEY = "basis.startHere.dismissed";

export const START_HERE = {
  title: "Start here",
  intro: [
    "Basis watches the two PancakeSwap pools where MSFTB (tokenized Microsoft stock) trades on BNB Chain, and would only trade when the price gap between them beats every cost: both pools' fees, slippage and gas.",
    "Most of the time the gap is far smaller than those costs, so Basis correctly says no, and records why.",
  ],
  tryItTitle: "Try it",
  steps: [
    "Click an example instruction in the “Give an instruction” box, then Send.",
    "Watch the Guardrail Gate and the Audit Ledger update, about 10 seconds later.",
    "Try “Buy $1000 of MSFT” to see a safety block: it's over the $500 per-trade limit.",
  ],
  cantTrade: "This demo can't trade, on purpose. See the real trade:",
  videoLabel: "Demo video",
  videoPending: "Demo video: coming soon",
  transactionsLabel: "The four transactions on BscScan",
  noSignup: "No wallet, deposit or sign-up needed.",
  dismiss: "Got it, hide this",
} as const;

export const START_HERE_TXS = LIVE_PROOF_TXS.map((tx) => ({ label: tx.label, url: bscScanTxUrl(tx.hash) }));
