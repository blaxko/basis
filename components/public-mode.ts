// The PUBLIC_READ_ONLY rule, for app/page.tsx, which renders the Start here
// panel on the server and may not import lib/ (test/architecture.test.ts).
// Same fail-closed parse as lib/config/deployment.ts's isPublicReadOnly():
// unset, "" or "false" is normal mode; anything else is read-only.
// test/public-mode.test.ts checks the two agree.
export function publicReadOnlyFromEnv(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim();
  return !(value === "" || value === "false");
}
