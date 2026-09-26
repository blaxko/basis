// What a dashboard panel says when its poll fails. The server's own
// `error` string when it sent one (already public-safe, e.g. the rate
// limiter's), otherwise the status only — never the route's URL.
export function pollErrorMessage(status: number, json: unknown): string {
  const error = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  return typeof error === "string" ? error : `the server returned an error (HTTP ${status})`;
}
