import { LANDING } from "./landing-content";

// The landing page's decoration. Every piece is aria-hidden or repeats
// words already on the page, carries no data, and sits behind the content:
// the page reads the same without it. The motion itself is in
// landing-motion.tsx.

// Behind the hero: a fading line grid and three soft light blobs that
// drift slowly and lean toward the pointer. They are what the hero's
// liquid-glass card bends and blurs.
export function HeroBackdrop() {
  return (
    <div className="l-hero-bg" aria-hidden="true">
      <div className="l-hero-grid-lines" />
      <div className="l-orb l-orb--a" data-drift="0" />
      <div className="l-orb l-orb--b" data-drift="1" />
      <div className="l-orb l-orb--c" data-drift="2" />
    </div>
  );
}

// Faint rings behind the live card, echoing the two pools it reads.
// Drawn inline; nothing here is to scale.
export function PoolRings() {
  return (
    <svg className="l-rings" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <circle className="l-ring l-ring--outer" cx="200" cy="200" r="188" />
      <circle className="l-ring" cx="200" cy="200" r="150" />
      <circle className="l-ring l-ring--dash" cx="200" cy="200" r="112" />
    </svg>
  );
}

// A slow strip of the page's own rules. The list is repeated once so the
// strip can loop; screen readers get the first copy only.
export function FactTicker() {
  const items = LANDING.ticker;
  return (
    <div className="l-ticker" data-marquee>
      <div className="l-ticker-track" data-marquee-track>
        {[0, 1].map((copy) => (
          <ul className="l-ticker-list" key={copy} aria-hidden={copy === 1 ? "true" : undefined}>
            {items.map((t) => (
              <li key={t}>
                <span className="l-ticker-dot" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
