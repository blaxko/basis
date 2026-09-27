import { describe, it, expect, afterEach, vi } from "vitest";
import { publicReadOnlyFromEnv } from "../components/public-mode";
import { isPublicReadOnly } from "../lib/config/deployment";

// app/page.tsx decides on the server whether to render the Start here panel
// (so it's in the first paint, with no layout shift), but app/ may not
// import lib/. components/public-mode.ts parses PUBLIC_READ_ONLY itself;
// it must agree with lib/config/deployment.ts on every input.

afterEach(() => vi.unstubAllEnvs());

describe("publicReadOnlyFromEnv agrees with isPublicReadOnly", () => {
  it.each([undefined, "", "false", "true", "True", "yes", "0", " true ", "FALSE"])("PUBLIC_READ_ONLY=%s", (value) => {
    if (value === undefined) vi.stubEnv("PUBLIC_READ_ONLY", undefined as unknown as string);
    else vi.stubEnv("PUBLIC_READ_ONLY", value);
    expect(publicReadOnlyFromEnv(process.env.PUBLIC_READ_ONLY)).toBe(isPublicReadOnly());
  });
});
