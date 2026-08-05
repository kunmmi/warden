"use client";

import { useEffect } from "react";

/**
 * Register the service worker that makes the dashboard installable.
 *
 * Deliberately quiet about failure. A service worker only registers on a SECURE
 * origin — https, or localhost. That means the normal `merrymen start` case works
 * (localhost:3100), and so does a hosted dashboard over https, but reaching the
 * dashboard by LAN IP with WARDEN_HOST=0.0.0.0 does NOT: http://192.168.x.x is
 * an insecure origin and the browser refuses. The app still works there, it just
 * can't be installed — so an unregistered worker is an expected condition on a
 * supported path, not an error worth shouting about.
 *
 * PRODUCTION ONLY. A registered service worker aggressively caches JS chunks —
 * in dev this silently serves a stale bundle through file edits, dev-server
 * restarts, and even a full `.next` cache wipe, because none of that touches
 * the browser's own cache. It looks exactly like a broken fix (the source is
 * correct, typechecks, and is confirmed correct via curl/DB — but the browser
 * keeps rendering the old behavior) and costs real debugging time figuring out
 * it's the service worker, not the code. Skip it below `next dev`.
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Nothing here should ever delay or break the trading UI.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
