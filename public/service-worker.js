/**
 * TaskTango PWA Service Worker
 * ----------------------------
 * Strategy (deliberately simple — we never want to serve stale data):
 *
 *   STATIC ASSETS  (/, /static/**, /icon-*.png, /manifest.json,
 *                   /training-guides/*.html)
 *     → stale-while-revalidate: serve from cache instantly, refresh
 *       cache in the background so the NEXT load is up to date
 *
 *   APP NAVIGATIONS  (HTML doc requests)
 *     → network-first with cache fallback for offline. We refresh the
 *       cached index.html on every successful network hit so a "Refresh
 *       to update" notice can be wired in later if we ever want one.
 *
 *   API CALLS  (anything under /api/*, including SSE)
 *     → bypassed entirely — never cached. Mobile mustn't see stale chat
 *       or attendance data.
 *
 * Versioning: bump CACHE_NAME on any breaking change to force the
 * service worker to discard old caches on activation.
 */

const CACHE_NAME = 'tasktango-pwa-v4.7.0';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-512.png',
  '/web-electron-shim.js?v=2.1.0'
];

// ─── Install ──────────────────────────────────────────────────────────────
// Pre-cache the bare minimum so first load works offline immediately.
// We deliberately don't pre-cache the React bundle — the filename is hashed
// (e.g. main.abc123.js), so it'd be impossible to know ahead of time.
// Those get cached on demand by the fetch handler below.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Failures here would block the install entirely; tolerate misses.
      return Promise.allSettled(
        PRECACHE_URLS.map((u) => cache.add(u).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────
// Drop every cache that isn't the current version. Take control of all
// open tabs immediately so the new SW handles requests right away.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET — POST/PUT/DELETE are never cached.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. API calls → straight to the network, no cache layer.
  //    /api/* includes the SSE event stream (/api/chat/stream) which would
  //    BREAK if served from cache (it's an open connection).
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    return; // letting it fall through means the browser handles it normally
  }

  // 2. App navigations (HTML documents) → network-first, cache fallback.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy).catch(() => {}));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // 3. Everything else (JS chunks, CSS, fonts, images, training guides)
  //    → stale-while-revalidate. Serve from cache instantly, kick off a
  //    background refresh so next load is up to date.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((res) => {
        // Only cache same-origin successful responses; opaque responses
        // (e.g. third-party CDN) are passed through without caching.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy).catch(() => {}));
        }
        return res;
      }).catch(() => cached); // network failure → fall back to cache
      return cached || networkFetch;
    })
  );
});

// ─── Messages from the app ─────────────────────────────────────────────────
// Allow the React app to ask the SW to update itself immediately (e.g.
// after the user accepts an "Update available" banner).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
