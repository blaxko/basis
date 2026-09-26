import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // See test/stubs/server-only.ts for why this is aliased under vitest.
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Several tests re-import modules (next/server, viem), which can take
    // several seconds while heavy tests (test/ledger-memory.test.ts's
    // three-week simulation) run in parallel workers. The default 5 s made
    // them fail on load, not on behaviour.
    testTimeout: 20_000,
    include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
  },
});
