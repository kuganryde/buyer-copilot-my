"use client";

// Branded splash, shown once per browser session.
//
// Safety and accessibility decisions (why this is not just a pretty overlay):
//  * Never blocks a user: skippable by click, Enter/Escape or the visible button; skipped entirely
//    under prefers-reduced-motion; and a CSS-only failsafe hides it even if JS fails to hydrate.
//  * While visible, the app shell is `inert` so keyboard and screen-reader users cannot land on
//    content hidden behind the overlay. It is removed from the DOM afterwards.
//  * Announces a polite status message instead of exposing decorative animation to AT.
//  * Uses sessionStorage only as a convenience (try/catch: private mode must not break it).

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { COMPANY, LogoMark } from "./brand";

const SEEN_KEY = "copilot.splash.seen";
const HOLD_MS = 1750; // how long the brand holds before the exit transition starts
const EXIT_MS = 650;  // must match --splash-exit in globals.css

// useLayoutEffect on the client avoids a one-frame flash of the splash for returning sessions;
// it is a no-op on the server render.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function Splash({ appTitle, tagline, loading, skip }: {
  appTitle: string; tagline: string; loading: string; skip: string;
}) {
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");

  const finish = useCallback(() => {
    try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* convenience only */ }
    setPhase((p) => (p === "show" ? "leave" : p));
  }, []);

  // Decide before first paint whether to show at all.
  useIsoLayoutEffect(() => {
    let seen = false;
    try { seen = window.sessionStorage.getItem(SEEN_KEY) === "1"; } catch { /* ignore */ }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduce) setPhase("gone");
  }, []);

  // Auto-dismiss timer, plus dismissal by keyboard.
  useEffect(() => {
    if (phase !== "show") return;
    const timer = window.setTimeout(finish, HOLD_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [phase, finish]);

  useEffect(() => {
    if (phase !== "leave") return;
    const timer = window.setTimeout(() => setPhase("gone"), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Keep the app shell unreachable while the overlay is up.
  useEffect(() => {
    const root = document.getElementById("app-root");
    if (!root) return;
    if (phase === "gone") root.removeAttribute("inert"); else root.setAttribute("inert", "");
    return () => root.removeAttribute("inert");
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div className="splash" data-phase={phase} onClick={finish}>
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-body">
        <LogoMark size={92} className="splash-mark" />
        <p className="splash-name">{appTitle}</p>
        <p className="splash-tag">{tagline}</p>
      </div>
      <div className="splash-foot">
        <span className="splash-bar" aria-hidden="true" />
        <p className="splash-company">{COMPANY.name}</p>
        <button type="button" className="splash-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>{skip}</button>
      </div>
      <p className="sr-only" role="status">{loading}</p>
    </div>
  );
}
