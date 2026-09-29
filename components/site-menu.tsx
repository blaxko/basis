"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SiteSection } from "./site-sections";

// The header's menu, on both pages at every width: the page's own
// sections. Tapping one scrolls there (smooth unless reduced motion is
// asked for; see globals.css) and closes the menu. Escape or a tap outside
// also closes it; focus goes to the first item on open and back to the
// button on Escape.
export function SiteMenu({ sections }: { sections: readonly SiteSection[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="site-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>
      <nav id={id} className="site-menu-panel" hidden={!open} aria-label="Sections on this page">
        <ul>
          {sections.map((s, i) => (
            <li key={s.href}>
              <a href={s.href} ref={i === 0 ? firstItem : undefined} onClick={() => setOpen(false)}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
