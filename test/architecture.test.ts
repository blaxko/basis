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
