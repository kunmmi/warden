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
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Nothing here should ever delay or break the trading UI.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
