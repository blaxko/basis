import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readOnlyNote, revertLabel } from "../components/read-only-note";

// The public demo greys out Live; the dashboard says so in one short line
// that links the landing page's explanation (its FAQ).

describe("readOnlyNote", () => {
  it("one short line on a read-only deployment, linking the landing page's FAQ, and the Live button's tooltip", () => {
    const note = readOnlyNote(true)!;
    expect(note.text).toBe("Public demo: read-only");
    expect(note.linkUrl).toBe("/#faq");
    expect(note.liveButtonTitle).toContain("read-only");
    expect(note.liveButtonTitle).toContain("nothing can be sent");
  });

  it("says nothing when the deployment isn't read-only, or before status has loaded", () => {
    expect(readOnlyNote(false)).toBeNull();
    expect(readOnlyNote(undefined)).toBeNull();
  });

  it("the landing page's FAQ answers it", () => {
    expect(readFileSync(join(__dirname, "..", "app", "(site)", "page.tsx"), "utf8")).toContain('id="faq"');
    expect(readFileSync(join(__dirname, "..", "components", "landing-content.ts"), "utf8")).toContain("The public demo is read-only by design.");
  });

  it("the header renders the note and the button tooltip", () => {
    const header = readFileSync(join(__dirname, "..", "components", "header.tsx"), "utf8");
    // The server's answer (the page's prop) until /api/status arrives, so
    // the note and the locked Live button are in the first paint.
    expect(header).toContain("const readOnly = status.data?.publicReadOnly ?? publicReadOnly;");
    expect(header).toContain("readOnlyNote(readOnly)");
    expect(header).toContain('className="strip-note"');
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
