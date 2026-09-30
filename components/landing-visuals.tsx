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

// Behind the whole landing page: soft light blobs fixed to the screen,
// so every glass panel has light to blur as the page scrolls past. They
// drift like the hero's.
export function PageBackdrop() {
  return (
    <div className="l-page-bg" aria-hidden="true">
      <div className="l-orb l-orb--p1" data-drift="3" />
      <div className="l-orb l-orb--p2" data-drift="4" />
      <div className="l-orb l-orb--p3" data-drift="5" />
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
