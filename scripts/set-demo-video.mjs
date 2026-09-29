// Sets the demo video link everywhere it appears, in one step:
//
//   npm run set-demo-video -- https://youtu.be/…
//
// - components/landing-content.ts: DEMO_VIDEO_URL (the landing page's hero)
// - README.md and docs/how-to-use.md: the text between
//   <!-- demo-video --> and <!-- /demo-video -->
//
// test/docs-honesty.test.ts checks the three stay in agreement.
// `--root <dir>` points it at another checkout (used by that test).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const root = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), "..") : args[rootFlag + 1];
const url = args.find((a, i) => !a.startsWith("--") && (rootFlag === -1 || i !== rootFlag + 1));

if (!url || !/^https:\/\/\S+$/.test(url)) {
  console.error("usage: npm run set-demo-video -- https://<video url>");
  process.exit(1);
}

function update(file, transform) {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${file}: nothing to update (marker or constant not found)`);
  writeFileSync(path, after);
  console.log(`updated ${file}`);
}

update("components/landing-content.ts", (s) =>
  s.replace(/export const DEMO_VIDEO_URL: string \| null = (?:null|"[^"]*");/, `export const DEMO_VIDEO_URL: string | null = ${JSON.stringify(url)};`)
);

const MARK = /<!-- demo-video -->[\s\S]*?<!-- \/demo-video -->/;
for (const file of ["README.md", "docs/how-to-use.md"]) {
  update(file, (s) => s.replace(MARK, `<!-- demo-video -->[demo video](${url})<!-- /demo-video -->`));
}
