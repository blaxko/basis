import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = resolveRoot();

function resolveRoot(): string {
  // vitest.config.ts's `root` isn't exposed to test files directly, and
  // __dirname here is <repo>/test, so the repo root is one level up.
  return join(__dirname, "..");
}

function listTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTsxFiles(full);
    if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".test.ts")) {
      return [full];
    }
    return [];
  });
}

const IMPORT_RE = /import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gs;

function findImportSources(content: string): string[] {
  const sources: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content))) {
    sources.push(match[2] ?? "");
  }
  return sources;
}

// A "route file" is app/api/**/route.ts — the only place allowed to
// import from lib/, since it's the seam between the UI and the backend.
function isRouteFile(relPath: string): boolean {
  const parts = relPath.split(sep);
  return parts[0] === "app" && parts[1] === "api" && relPath.endsWith(`${sep}route.ts`);
}

function listAllSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listAllSourceFiles(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("architecture: live single-leg execution stays unwired", () => {
  // executeDirectSwap is the only path that can send a swap. Until
  // two-leg execution exists it may be referenced only by its own module
  // and that module's tests — never by the scheduler, a route, or the UI.
  const allowed = new Set([join("lib", "execution", "pipeline.ts"), join("lib", "execution", "pipeline.test.ts")]);

  it("no file other than lib/execution/pipeline.ts and its test references executeDirectSwap", () => {
    const files = ["app", "components", "lib", "test"].flatMap((d) => listAllSourceFiles(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const relPath = relative(ROOT, file);
      if (allowed.has(relPath) || relPath === join("test", "architecture.test.ts")) continue;
      expect(readFileSync(file, "utf8").includes("executeDirectSwap"), `${relPath} references executeDirectSwap`).toBe(false);
    }
  });
});

describe("architecture: who may reach the send path", () => {
  const sourceFiles = () => ["app", "components", "lib", "test"].flatMap((d) => listAllSourceFiles(join(ROOT, d)));

  // agentic-wallet.ts's send() is the only function that signs and
  // broadcasts. Outside tests, only the pipeline (whose executeDirectSwap
  // stays unwired) and the manual execution test may import it.
  it("only pipeline.ts and execution-test.ts import send from agentic-wallet", () => {
    const allowedSendCallers = new Set([join("lib", "execution", "pipeline.ts"), join("lib", "execution", "execution-test.ts")]);
    const importsSend = /import\s*\{[^}]*\bsend\b[^}]*\}\s*from\s*["'][^"']*agentic-wallet["']/s;
    const offenders = sourceFiles()
      .filter((f) => !f.endsWith(".test.ts"))
      .map((f) => relative(ROOT, f))
      .filter((rel) => importsSend.test(readFileSync(join(ROOT, rel), "utf8")) && !allowedSendCallers.has(rel));
    expect(offenders).toEqual([]);
    // Sanity: the pattern does match the two allowed callers.
    for (const rel of allowedSendCallers) expect(importsSend.test(readFileSync(join(ROOT, rel), "utf8")), rel).toBe(true);
  });

  // The execution test is reachable only through its own route — never
  // from the scheduler, the agent loop, or the instruction handler.
  it("only execution-test.ts, its test, and app/api/execution-test/route.ts reference runExecutionTest", () => {
    const allowed = new Set([
      join("lib", "execution", "execution-test.ts"),
      join("lib", "execution", "execution-test.test.ts"),
      join("app", "api", "execution-test", "route.ts"),
      join("test", "architecture.test.ts"),
    ]);
    const offenders = sourceFiles()
      .map((f) => relative(ROOT, f))
      .filter((rel) => !allowed.has(rel) && readFileSync(join(ROOT, rel), "utf8").includes("runExecutionTest"));
    expect(offenders).toEqual([]);
  });

  it("nothing outside that route imports the execution-test module", () => {
    const allowed = new Set([join("lib", "execution", "execution-test.test.ts"), join("app", "api", "execution-test", "route.ts")]);
    const offenders = sourceFiles()
      .map((f) => relative(ROOT, f))
      .filter((rel) => !allowed.has(rel) && findImportSources(readFileSync(join(ROOT, rel), "utf8")).some((s) => s.endsWith("execution-test")));
    expect(offenders).toEqual([]);
  });
});

describe("architecture: every broadcast goes through Binance with MEV protection", () => {
  // The only broadcast is broadcastWithMevProtection() in
  // lib/data/binance-transaction.ts. A public-RPC broadcast anywhere would
  // silently drop MEV protection, including as a "fallback".
  it("no source file broadcasts through an RPC (sendTransaction / sendRawTransaction / eth_sendRawTransaction)", () => {
    const files = ["app", "components", "lib"].flatMap((d) => listAllSourceFiles(join(ROOT, d))).filter((f) => !f.endsWith(".test.ts"));
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const needle of ["sendTransaction(", "sendRawTransaction", "eth_sendRawTransaction"]) {
        expect(content.includes(needle), `${relative(ROOT, file)} contains ${needle}`).toBe(false);
      }
    }
  });

  it("the broadcast body hardcodes enableMevProtection: true", () => {
    const content = readFileSync(join(ROOT, "lib", "data", "binance-transaction.ts"), "utf8");
    expect(content).toContain("enableMevProtection: true");
    expect(content).not.toMatch(/enableMevProtection:\s*(false|params|[a-z]+\.)/);
  });
});

describe("architecture: the dashboard (app/, components/) only consumes API routes", () => {
  const appDir = join(ROOT, "app");
  const componentsDir = join(ROOT, "components");

  const files = [
    ...listTsxFiles(appDir),
    ...(statSync(componentsDir, { throwIfNoEntry: false }) ? listTsxFiles(componentsDir) : []),
  ];

  it("found at least one source file to check (sanity check on the test itself)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no file under app/ or components/, except app/api/**/route.ts, imports from lib/", () => {
    for (const file of files) {
      const relPath = relative(ROOT, file);
      if (isRouteFile(relPath)) continue;

      const sources = findImportSources(readFileSync(file, "utf8"));
      for (const source of sources) {
        const isLibImport = /^(\.\.\/)+lib\//.test(source) || /^lib\//.test(source) || /^@\/lib\//.test(source);
        expect(isLibImport, `${relPath} imports from lib/: "${source}"`).toBe(false);
      }
    }
  });
});
