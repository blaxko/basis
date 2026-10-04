"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { SiteSection } from "./site-sections";

// The header's menu, at every width. On the landing page and its four
// pages it lists the pages (the current one is marked, and GitHub opens the
// repo in a new tab and says so); on the dashboard it lists the
// dashboard's own panels and scrolls to them. Escape or a tap outside
// closes it; focus goes to the current (or first) item on open and back to
// the button on Escape.
export function SiteMenu({ sections, label = "Sections on this page" }: { sections: readonly SiteSection[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);

  const isActive = (s: SiteSection) => !s.external && s.href === pathname;
  const current = sections.findIndex(isActive);
  const focusIndex = current >= 0 ? current : 0;

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
      <nav id={id} className="site-menu-panel" hidden={!open} aria-label={label}>
        <ul>
          {sections.map((s, i) => {
            const active = isActive(s);
            return (
              <li key={s.href}>
                <a
                  href={s.href}
                  ref={i === focusIndex ? firstItem : undefined}
                  aria-current={active ? "page" : undefined}
                  {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={() => setOpen(false)}
                >
                  {s.label}
                  {s.external && (
                    <>
                      <svg className="ext-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="M7 17L17 7M8 7h9v9" />
                      </svg>
                      <span className="sr-only"> (opens in a new tab)</span>
                    </>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
