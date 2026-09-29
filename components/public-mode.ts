// The PUBLIC_READ_ONLY rule, for app/app/page.tsx, which renders the header
// on the server and may not import lib/ (test/architecture.test.ts).
// Same fail-closed parse as lib/config/deployment.ts's isPublicReadOnly():
// unset, "" or "false" is normal mode; anything else is read-only.
// test/public-mode.test.ts checks the two agree.
export function publicReadOnlyFromEnv(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim();
  return !(value === "" || value === "false");
}

// The trading wallet's address and balances are shown only on a local,
// non-public run. The public demo holds no key and shows neither.
export function showWalletChips(publicReadOnly: boolean): boolean {
  return !publicReadOnly;
}
