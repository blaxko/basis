import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { START_HERE, START_HERE_TXS, DEMO_VIDEO_URL, START_HERE_STORAGE_KEY } from "../components/start-here-content";
import { LIVE_PROOF_TXS } from "../components/read-only-note";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("Start here content", () => {
  it("says what Basis is in two sentences, including that it usually says no", () => {
    expect(START_HERE.intro).toHaveLength(2);
    expect(START_HERE.intro[0]).toContain("MSFTB");
    expect(START_HERE.intro[0]).toContain("beats every cost");
    expect(START_HERE.intro[1]).toContain("correctly says no");
  });

  it("has the three Try-it steps, ending with the $1000 safety block", () => {
    expect(START_HERE.steps).toHaveLength(3);
    expect(START_HERE.steps[0]).toContain("Give an instruction");
    expect(START_HERE.steps[1]).toContain("Guardrail Gate");
    expect(START_HERE.steps[1]).toContain("Audit Ledger");
    expect(START_HERE.steps[2]).toContain("Buy $1000 of MSFT");
    // The example must exist as a clickable button in the instruction box.
    expect(read("components", "instruction-box.tsx")).toContain('"Buy $1000 of MSFT"');
  });

  it("links the four real transactions on BscScan", () => {
    expect(START_HERE_TXS).toHaveLength(4);
    START_HERE_TXS.forEach((tx, i) => expect(tx.url).toBe(`https://bscscan.com/tx/${LIVE_PROOF_TXS[i]!.hash}`));
    // Same hashes as the verified record in docs/devex-log.md.
    const devex = read("docs", "devex-log.md");
    for (const tx of LIVE_PROOF_TXS) expect(devex).toContain(tx.hash);
  });

  it("the demo video is a placeholder until its URL is set, never a dead link", () => {
    expect(DEMO_VIDEO_URL).toBeNull();
    expect(START_HERE.videoPending).toBe("Demo video: coming soon");
    const panel = read("components", "start-here.tsx");
    expect(panel).toContain("DEMO_VIDEO_URL ? (");
  });

  it("says no wallet, deposit or sign-up is needed, and that the demo can't trade on purpose", () => {
    expect(START_HERE.noSignup).toBe("No wallet, deposit or sign-up needed.");
    expect(START_HERE.cantTrade).toBe("This demo can't trade, on purpose. See the real trade:");
  });
});

describe("Start here wiring", () => {
  it("is on the page, directly under the header", () => {
    const page = read("app", "page.tsx");
    expect(page).toContain("<StartHere />");
    expect(page.indexOf("<Header />")).toBeLessThan(page.indexOf("<StartHere />"));
    expect(page.indexOf("<StartHere />")).toBeLessThan(page.indexOf('<div className="bento-grid">'));
  });

  it("shows only on the public read-only demo, and remembers dismissal per visitor", () => {
    const panel = read("components", "start-here.tsx");
    expect(panel).toContain("status.publicReadOnly === true");
    expect(panel).toContain("localStorage.getItem(START_HERE_STORAGE_KEY)");
    expect(panel).toContain("localStorage.setItem(START_HERE_STORAGE_KEY");
    expect(START_HERE_STORAGE_KEY).toBe("basis.startHere.dismissed");
  });

  it("the README starts with a For-judges section carrying the live link", () => {
    const readme = read("README.md");
    const firstSection = readme.slice(0, readme.indexOf("## What Basis is"));
    expect(readme.indexOf("## For judges: start here")).toBeLessThan(readme.indexOf("## What Basis is"));
    expect(firstSection).toContain("https://basis-production-c229.up.railway.app");
    expect(firstSection).toContain("Buy $1000 of MSFT");
    expect(firstSection).toContain("no wallet, deposit or sign-up needed");
  });
});
