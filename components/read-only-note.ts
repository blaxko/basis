// What the dashboard says about the public, read-only deployment: one short
// line, linking the landing page's explanation, and the greyed-out Live
// button's tooltip. Kept as plain data so it can be tested without rendering.

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
    text: "Public demo: read-only",
    linkLabel: "what that means",
    linkUrl: "/#faq",
    liveButtonTitle: "Disabled on this public, read-only demo — no wallet key, nothing can be sent.",
  };
}

// "Returns to simulation at 21:14 UTC." — the public demo's automatic
// return of the killswitch to simulation (lib/orchestration/killswitch.ts).
export function revertLabel(iso: string): string {
  return `Returns to simulation at ${new Date(iso).toISOString().slice(11, 16)} UTC.`;
}
