import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const LLM_DIR = __dirname;

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) return [full];
    return [];
  });
}

// Matches `import <clause> from "<source>"`, capturing whether the
// import clause starts with `type` and the module source path. The `s`
// flag lets <clause> span multiple lines (multi-line named imports).
const IMPORT_RE = /import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gs;

function findImports(content: string): Array<{ isTypeOnly: boolean; source: string }> {
  const imports: Array<{ isTypeOnly: boolean; source: string }> = [];
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content))) {
    imports.push({ isTypeOnly: Boolean(match[1]), source: match[2] ?? "" });
  }
  return imports;
}

describe("architecture: lib/llm stays isolated from execution", () => {
  const files = listTsFiles(LLM_DIR);

  it("found at least one source file to check (sanity check on the test itself)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no file under lib/llm imports anything from lib/execution", () => {
    for (const file of files) {
      const imports = findImports(readFileSync(file, "utf8"));
      for (const { source } of imports) {
        expect(source, `${file} imports from execution: "${source}"`).not.toMatch(/\/execution(\/|$)/);
      }
    }
  });

  it("any import from lib/guardrails is type-only, never a value import of check()", () => {
    for (const file of files) {
      const imports = findImports(readFileSync(file, "utf8"));
      for (const { isTypeOnly, source } of imports) {
        if (/\/guardrails(\/|$)/.test(source)) {
          expect(isTypeOnly, `${file} imports from guardrails without 'import type': "${source}"`).toBe(true);
        }
      }
    }
  });

  it("groq-client.ts declares itself server-only", () => {
    const content = readFileSync(join(LLM_DIR, "groq-client.ts"), "utf8");
    expect(content).toMatch(/^import\s+["']server-only["'];?/m);
  });
});
