"use client";

import { useEffect } from "react";

// Runs before the page paints (an inline script at the top of the landing
// page): marks the page as animated unless the visitor asked for reduced
// motion, then fades the hero in. If this component never mounts (the
// bundle fails to load), the mark comes off again after 3 s so nothing
// stays hidden.
export const MOTION_BOOT = `(function(){var d=document.documentElement;if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.classList.add("motion-ok");setTimeout(function(){d.classList.add("hero-in")},60);setTimeout(function(){if(!d.classList.contains("motion-live"))d.classList.remove("motion-ok")},3000)})();`;

// The landing page's motion, all of it CSS transitions (no keyframes, no
// frame loop): sections rise in as they scroll into view, the hero's
// blobs drift and lean toward the pointer, the glass card's highlight
// follows the pointer, cards light up under the pointer, the fact strip
// scrolls, and the top bar turns to glass once the page scrolls. Nothing
// moves when the visitor prefers reduced motion.
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("motion-ok")) return;
    root.classList.add("motion-live", "hero-in");
    const cleanups: Array<() => void> = [];

    // Rise in on scroll.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    // The top bar turns to glass once the page has scrolled.
    const bar = document.querySelector(".landing .topbar");
    const onScroll = () => bar?.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener("scroll", onScroll));

    // Pointer position over the hero, as -1…1 from its centre (blobs) and
    // as a position inside the glass card (its highlight).
    const hero = document.querySelector<HTMLElement>(".l-hero");
    const card = hero?.querySelector<HTMLElement>(".live-card");
    const onHeroMove = (e: PointerEvent) => {
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      hero.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
      if (card) {
        const c = card.getBoundingClientRect();
        card.style.setProperty("--gx", `${e.clientX - c.left}px`);
        card.style.setProperty("--gy", `${e.clientY - c.top}px`);
      }
    };
    const onHeroLeave = () => {
      hero?.style.setProperty("--px", "0");
      hero?.style.setProperty("--py", "0");
    };
    hero?.addEventListener("pointermove", onHeroMove);
    hero?.addEventListener("pointerleave", onHeroLeave);
    cleanups.push(() => {
      hero?.removeEventListener("pointermove", onHeroMove);
      hero?.removeEventListener("pointerleave", onHeroLeave);
    });

    // Cards light up where the pointer is.
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".landing .l-tile"));
    const onTileMove = (e: PointerEvent) => {
      const t = e.currentTarget as HTMLElement;
      const r = t.getBoundingClientRect();
      t.style.setProperty("--tx", `${e.clientX - r.left}px`);
      t.style.setProperty("--ty", `${e.clientY - r.top}px`);
    };
    tiles.forEach((t) => t.addEventListener("pointermove", onTileMove));
    cleanups.push(() => tiles.forEach((t) => t.removeEventListener("pointermove", onTileMove)));

    // The blobs drift: each glides to a new spot over 14 s (the CSS
    // transition on `translate`), then picks the next. The pointer tilts
    // them by depth through --px / --py (the transition on `transform`).
    const orbs = Array.from(document.querySelectorAll<HTMLElement>("[data-drift]"));
    const drift = (orb: HTMLElement) => {
      orb.style.translate = `${Math.round(Math.random() * 80 - 40)}px ${Math.round(Math.random() * 60 - 30)}px`;
    };
    const onDriftEnd = (e: TransitionEvent) => {
      if (e.propertyName === "translate") drift(e.currentTarget as HTMLElement);
    };
    orbs.forEach((orb) => {
      orb.addEventListener("transitionend", onDriftEnd);
      drift(orb);
    });
    cleanups.push(() => orbs.forEach((orb) => orb.removeEventListener("transitionend", onDriftEnd)));

    // The fact strip: one linear transition across the first copy of the
    // list, then an instant jump back (the second copy looks identical),
    // and again.
    const track = document.querySelector<HTMLElement>("[data-marquee-track]");
    const run = () => {
      if (!track) return;
      const half = track.scrollWidth / 2;
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
      void track.offsetWidth; // apply the jump before the next transition starts
      track.style.transition = `transform ${Math.round(half / 32)}s linear`;
      track.style.transform = `translate3d(${-half}px, 0, 0)`;
    };
    const onLoopEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") run();
    };
    track?.addEventListener("transitionend", onLoopEnd);
    run();
    cleanups.push(() => track?.removeEventListener("transitionend", onLoopEnd));

    return () => cleanups.forEach((c) => c());
  }, []);

  return null;
}
