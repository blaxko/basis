import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readOnlyNote, revertLabel, LIVE_PROOF_TX, LIVE_PROOF_URL } from "../components/read-only-note";

// The public demo greys out Live; the dashboard must say why.

describe("readOnlyNote", () => {
  it("explains the disabled Live button on a read-only deployment and points to the proof", () => {
    const note = readOnlyNote(true)!;
    expect(note.text).toContain("Live trading is switched off on this public demo");
    expect(note.text).toContain("can't send transactions");
    expect(note.text).toContain("proven separately on BNB Chain mainnet on 2026-09-25");
    expect(note.linkUrl).toBe(LIVE_PROOF_URL);
    expect(note.liveButtonTitle).toContain("read-only");
  });

  it("says nothing when the deployment isn't read-only, or before status has loaded", () => {
    expect(readOnlyNote(false)).toBeNull();
    expect(readOnlyNote(undefined)).toBeNull();
  });

  it("the link lands on the README's Status section, which links the transaction on BscScan", () => {
    const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    expect(LIVE_PROOF_URL.endsWith("#status")).toBe(true);
    expect(readme).toMatch(/^## Status$/m);
    const status = readme.slice(readme.indexOf("## Status"), readme.indexOf("## Run it locally"));
    expect(status).toContain(`https://bscscan.com/tx/${LIVE_PROOF_TX}`);
  });

  it("the header renders the note and the button tooltip", () => {
    const header = readFileSync(join(__dirname, "..", "components", "header.tsx"), "utf8");
    expect(header).toContain("readOnlyNote(status.data?.publicReadOnly)");
    expect(header).toContain('className="killswitch-note"');
    expect(header).toContain("note.liveButtonTitle");
  });
});

describe("revertLabel", () => {
  it("shows the public demo's return time as HH:MM UTC", () => {
    expect(revertLabel("2026-09-25T21:15:30.000Z")).toBe("Returns to simulation at 21:15 UTC.");
  });

  it("the header shows it only while a return is pending", () => {
    const header = readFileSync(join(__dirname, "..", "components", "header.tsx"), "utf8");
    expect(header).toContain("status.data?.killswitchRevertsAt &&");
    expect(header).toContain("revertLabel(status.data.killswitchRevertsAt)");
  });
});
