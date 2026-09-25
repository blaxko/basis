// What the dashboard says about the greyed-out Live button on the public,
// read-only deployment, so a visitor isn't left guessing. Kept as plain
// data so it can be tested without rendering.

export const LIVE_PROOF_URL = "https://github.com/blaxko/basis#status";

// The sell leg of the 2026-09-25 mainnet round trip (the last of its
// four transactions); the others are listed at LIVE_PROOF_URL.
export const LIVE_PROOF_TX = "0xc77ffb104e42303913745f519922af6d61dc3f988f5940c53a9e388e689cc1ff";

export interface ReadOnlyNote {
  text: string;
  linkLabel: string;
  linkUrl: string;
  liveButtonTitle: string;
}

// null when the deployment isn't read-only (Live is then a real choice).
export function readOnlyNote(publicReadOnly: boolean | undefined): ReadOnlyNote | null {
  if (!publicReadOnly) return null;
  return {
    text:
      "Live trading is switched off on this public demo: it holds no wallet key and can't send transactions. " +
      "Simulation and dry-run work as usual. The live path was proven separately on BNB Chain mainnet on 2026-09-25 " +
      "with a $5 round trip, run locally.",
    linkLabel: "See the four transactions",
    linkUrl: LIVE_PROOF_URL,
    liveButtonTitle: "Disabled on this public, read-only demo — no wallet key, nothing can be sent.",
  };
}

// "Returns to simulation at 21:14 UTC." — the public demo's automatic
// return of the killswitch to simulation (lib/orchestration/killswitch.ts).
export function revertLabel(iso: string): string {
  return `Returns to simulation at ${new Date(iso).toISOString().slice(11, 16)} UTC.`;
}
