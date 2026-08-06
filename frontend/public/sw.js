/* 60'6" ID — minimal offline app-shell cache.
 *
 * Why this exists: without it, a cold page load while offline fails entirely,
 * so an evaluator whose phone drops the tab mid-camp loses the evaluation UI.
 *
 * Deliberate design choices:
 *  - Navigations are NETWORK-FIRST. While online you always get the freshly
 *    deployed index.html, so a stale app shell cannot survive a deploy. The
 *    cached shell is used only when the network actually fails.
 *  - /api/ traffic is never cached or served from cache. A cached 200 could be
 *    mistaken for a successful save, and evaluation data must stay authoritative
 *    on the server.
 *  - Caches are version-namespaced; activate() deletes every other pbg-* cache.
 *
 * DEPLOY NOTE: bump SW_VERSION on every release. Even if you forget, the
 * network-first navigation means an online client still gets the new
 * index.html, which references the new content-hashed /static/ bundles.
 */

const SW_VERSION = "2026-08-04.1";
const SHELL_CACHE = `pbg-shell-${SW_VERSION}`;
const ASSET_CACHE = `pbg-assets-${SW_VERSION}`;

const SHELL_URLS = ["/", "/index.html", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      // allSettled: one missing file must not leave the shell uncached.
      await Promise.allSettled(
        SHELL_URLS.map((u) => cache.add(new Request(u, { cache: "reload" }))),
      );
    } catch (e) {
      /* never block activation on a cache miss */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("pbg-") && k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
    } catch (e) { /* ignore */ }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "pbg-sw-skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Cross-origin (including a separate API host) — leave completely alone.
  if (url.origin !== self.location.origin) return;
  // Same-origin API proxy — never cache, never serve stale.
  if (url.pathname.startsWith("/api/")) return;

  // ---- Navigations: network-first, cached shell only on network failure ----
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          try {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put("/index.html", fresh.clone());
          } catch (e) { /* ignore */ }
        }
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        const hit = (await cache.match("/index.html")) || (await cache.match("/"));
        return hit || Response.error();
      }
    })());
    return;
  }

  // ---- Content-hashed build output: cache-first (filename changes per deploy) ----
  if (url.pathname.startsWith("/static/")) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.status === 200) { try { await cache.put(req, res.clone()); } catch (e) { /* ignore */ } }
        return res;
      } catch (e) {
        return Response.error();
      }
    })());
    return;
  }

  // ---- Other same-origin assets: network-first with cache fallback ----
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === "basic") {
        try {
          const cache = await caches.open(ASSET_CACHE);
          await cache.put(req, res.clone());
        } catch (e) { /* ignore */ }
      }
      return res;
    } catch (e) {
      try {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
      } catch (e2) { /* ignore */ }
      return Response.error();
    }
  })());
});
