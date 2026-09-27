"use client";

import { useEffect, useState } from "react";
import { DEMO_VIDEO_URL, START_HERE, START_HERE_COOKIE, START_HERE_STORAGE_KEY, START_HERE_TXS } from "./start-here-content";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(START_HERE_STORAGE_KEY) === "1";
  } catch {
    return false; // storage blocked: show it
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(START_HERE_STORAGE_KEY, "1");
  } catch {
    // storage blocked: the cookie below still remembers it
  }
  // Read by the server (app/page.tsx), so a returning visitor's page is
  // rendered without the panel: nothing appears and then disappears.
  document.cookie = `${START_HERE_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax`;
}

// Shown only on the public, read-only demo (that's where "this demo can't
// trade" is true), and only until the visitor dismisses it. The server
// decides from the deployment mode and the dismissal cookie
// (status.publicReadOnly === true and not dismissed), so the panel is in
// the first paint with no layout shift. On phones the body collapses
// behind "More" (CSS only).
export function StartHere({ status, dismissed }: { status: { publicReadOnly: boolean }; dismissed: boolean }) {
  const [visible, setVisible] = useState(status.publicReadOnly === true && !dismissed);
  const [expanded, setExpanded] = useState(false);

  // Dismissed before the cookie existed (localStorage only): hide it.
  useEffect(() => {
    if (visible && wasDismissed()) {
      setVisible(false);
      rememberDismissed();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <section className={"panel start-here" + (expanded ? " is-expanded" : "")} id="start" aria-label={START_HERE.title}>
      <div className="panel-head">
        <h2 className="panel-title">{START_HERE.title}</h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            rememberDismissed();
            setVisible(false);
          }}
        >
          {START_HERE.dismiss}
        </button>
      </div>

      <p className="start-here-text">{START_HERE.intro[0]}</p>
      <button type="button" className="btn-ghost start-here-more-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Less" : "More"}
      </button>

      <div className="start-here-more">
        <p className="start-here-text">{START_HERE.intro[1]}</p>
        <p className="start-here-subtitle">{START_HERE.tryItTitle}</p>
        <ol className="start-here-steps">
          {START_HERE.steps.map((step, i) => (
            <li key={step}>
              <span className="step-no mono">{String(i + 1).padStart(2, "0")}</span>
              {step}
            </li>
          ))}
        </ol>

        <p className="start-here-text start-here-proof">
          <strong>{START_HERE.cantTrade}</strong>{" "}
          {DEMO_VIDEO_URL ? (
            <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
              {START_HERE.videoLabel}
            </a>
          ) : (
            <span className="start-here-pending">{START_HERE.videoPending}</span>
          )}
          {" · "}
          {START_HERE.transactionsLabel}:{" "}
          {START_HERE_TXS.map((tx, i) => (
            <span key={tx.url}>
              <a href={tx.url} target="_blank" rel="noreferrer" title={tx.label}>
                {i + 1}. {tx.label}
                <ExternalIcon />
              </a>
              {i < START_HERE_TXS.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>

        <p className="start-here-text start-here-nosignup">{START_HERE.noSignup}</p>
      </div>
    </section>
  );
}

function ExternalIcon() {
  return (
    <svg className="icon-ext" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}
