"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, type ThemeName } from "./theme";

// The header's light/dark switch. Until a visitor chooses, the page follows
// the device (prefers-color-scheme, in CSS); a choice is remembered in this
// browser only and applied before paint on the next visit
// (THEME_INIT_SCRIPT in app/layout.tsx).
function currentTheme(): ThemeName {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle() {
  // null until mounted: the server can't know the visitor's theme, so the
  // icon appears after hydration (the button keeps its size meanwhile).
  const [theme, setTheme] = useState<ThemeName | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => setTheme(currentTheme());
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const next: ThemeName = theme === "light" ? "dark" : "light";

  function toggle() {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    setTheme(next);
  }

  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} disabled={theme === null}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {theme === "light" ? (
          // In light mode, offer the moon (switch to dark).
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        ) : theme === "dark" ? (
          // In dark mode, offer the sun (switch to light).
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : null}
      </svg>
    </button>
  );
}
