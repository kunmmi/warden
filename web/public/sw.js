/**
 * warden dashboard service worker.
 *
 * THE CACHING RULE HERE IS A SAFETY RULE, NOT A PERFORMANCE ONE.
 *
 * This app shows equity, open positions, live prices and a kill switch. A cached
 * API response is not a stale pixel — it is a wrong number that someone might
 * act on, or a kill switch that appears to have fired when it didn't. So:
 *
 *   /api/**        NEVER cached. Network only. If the network is gone the caller
 *                  gets an error and the UI says so, which is the truth.
 *   /_next/static  Cache-first. Content-hashed by the build, so a cached file can
 *                  never be the wrong version of itself.
 *   fonts, icons   Cache-first. Same reasoning.
 *   navigations    Network-first, falling back to /offline.html — so opening the
 *                  installed app with no connection explains itself instead of
 *                  showing the browser's dinosaur.
 *
 * Nothing else is cached. If you are tempted to add a stale-while-revalidate for
 * an API route to make the app feel snappier, don't: "feels live but isn't" is
 * the single worst property a trading UI can have.
 */

const VERSION = "v1";
const SHELL = `warden-shell-${VERSION}`;
const ASSETS = `warden-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll([OFFLINE_URL, "/icon-192.png", "/manifest.webmanifest"]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from an older VERSION, so a dashboard upgrade can't
      // leave a previous build's assets serving alongside the new one.
      const keep = new Set([SHELL, ASSETS]);
      await Promise.all((await caches.keys()).filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const isImmutableAsset = (url) => {
  // Dev hot-update chunks live under /_next/static/ but are the opposite of
  // immutable — the same filename is rewritten as you edit. Cache-first on those
  // pins a stale build in place. They don't exist in a production build, so this
  // only matters while developing, which is exactly when a pinned stale chunk is
  // most confusing.
  if (url.pathname.startsWith("/_next/static/webpack/")) return false;
  return url.pathname.startsWith("/_next/static/") || /\.(?:woff2?|png|svg|ico)$/.test(url.pathname);
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Someone else's origin is not ours to cache or reason about.
  if (url.origin !== self.location.origin) return;

  // Live data: hands off, entirely. Not cached, not read from cache, not even
  // as a fallback — a stale position is worse than a visible error.
  if (url.pathname.startsWith("/api/")) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) (await caches.open(ASSETS)).put(request, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
  }
});
