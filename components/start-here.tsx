"use client";

import { useEffect, useState } from "react";
import { DEMO_VIDEO_URL, START_HERE, START_HERE_STORAGE_KEY, START_HERE_TXS } from "./start-here-content";

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
    // storage blocked: hidden for this page view only
  }
}

// Shown only on the public, read-only demo (that's where "this demo
// can't trade" is true), and only until the visitor dismisses it.
// Decided after mount, so the server-rendered page never flashes it.
export function StartHere() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (wasDismissed()) return;
    let cancelled = false;
    fetch("/api/status")
      .then((res) => res.json())
      .then((status: { publicReadOnly?: boolean }) => {
        if (!cancelled && status.publicReadOnly === true) setVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <section className="panel start-here" aria-label={START_HERE.title}>
      <div className="start-here-top">
        <h2 className="panel-title">{START_HERE.title}</h2>
        <button
          type="button"
          className="start-here-dismiss"
          onClick={() => {
            rememberDismissed();
            setVisible(false);
          }}
        >
          {START_HERE.dismiss}
        </button>
      </div>

      {START_HERE.intro.map((p) => (
        <p key={p} className="start-here-text">
          {p}
        </p>
      ))}

      <p className="start-here-subtitle">{START_HERE.tryItTitle}</p>
      <ol className="start-here-steps">
        {START_HERE.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <p className="start-here-text">
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
            </a>
            {i < START_HERE_TXS.length - 1 ? " · " : ""}
          </span>
        ))}
      </p>

      <p className="start-here-text start-here-nosignup">{START_HERE.noSignup}</p>
    </section>
  );
}
