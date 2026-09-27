import { ImageResponse } from "next/og";
import { TOKENS } from "../components/theme";

// The browser-tab icon: a "B" for Basis in the theme's accent on its
// near-black, drawn from components/theme.ts (no image file, no logo).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: TOKENS.bg,
          color: TOKENS.accent,
          fontSize: 22,
          fontWeight: 700,
          borderRadius: 6,
        }}
      >
        B
      </div>
    ),
    size
  );
}
