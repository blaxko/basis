// Next.js calls register() once per server instance start — not per
// request, not per route import. It's compiled for both the Node and edge
// runtimes; the import must stay *inside* this `if` (not behind an early
// return) so webpack can statically drop it from the edge bundle, which
// can't resolve the scheduler's node:fs dependency.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./lib/orchestration/scheduler");
    start();
  }
}
