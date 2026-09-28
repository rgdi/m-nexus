/* ============================================================
 * sw.js — M-NEXUS service worker.
 *
 * v2.36.0 — Real PWA. The previous version (v2.0.0) was broken:
 *   - `caches.addAll()` cannot expand glob patterns, so the install
 *     handler silently failed and nothing was ever precached.
 *   - The worker was never registered from the app, so it never ran.
 *
 * Strategy
 *   - Precache: app shell (index.html, main.js, every CSS, the icons).
 *     JS modules are NOT precached individually — they are large and
 *     change often; the runtime cache handles them.
 *   - Navigation requests: network-first, falling back to the cached
 *     index.html (so the PWA opens offline).
 *   - Same-origin static assets: stale-while-revalidate.
 *   - API calls: never cached. Mutations go through the IndexedDB
 *     outbox in services/offline_queue.js and are replayed on reconnect.
 *   - Background Sync: when the browser supports it, we ask for a
 *     `mnexus-outbox-sync` sync so queued mutations flush as soon as
 *     connectivity returns, even if the tab was closed.
 * ============================================================ */

const VERSION = "v2.36.2";
const SHELL_CACHE = `mnexus-shell-${VERSION}`;
const RUNTIME_CACHE = `mnexus-runtime-${VERSION}`;
const SYNC_TAG = "mnexus-outbox-sync";

/**
 * sw-precache.js is generated (scripts/gen-sw-precache.py) and lists every
 * module under src/. It is imported here so the install step can precache
 * the whole app — without it, an offline cold start only gets the shell
 * HTML and then dies on the first missing ES-module import.
 */
importScripts("/sw-precache.js");

/** Files that MUST be present for the app to boot. */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.svg",
  "./src/main.js",
  "./src/styles/tokens.css",
  "./src/styles/base.css",
  "./src/styles/layout.css",
  "./src/styles/components.css",
  "./src/styles/notebook.css",
  "./src/styles/calendar.css",
  "./src/styles/print.css",
  "./src/styles/floating_window.css",
  "./src/styles/popups.css",
  "./src/styles/tour.css",
  "./src/styles/mobile.css",
];

/** Runtime-cacheable, cheap to refetch. */
const STATIC_RE = /\.(?:css|js|svg|png|jpg|jpeg|webp|woff2?|ttf|glb|gif|ico)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const targets = [...SHELL, ...(self.MODULES || [])];
      // Dedupe: main.js and the CSS files appear in both lists.
      const seen = new Set();
      const unique = targets.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
      // Add in small batches so one 404 cannot reject the whole install,
      // and so a slow module cannot serialise 130 requests.
      const BATCH = 12;
      for (let i = 0; i < unique.length; i += BATCH) {
        await Promise.all(
          unique.slice(i, i + BATCH).map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => {
              /* a missing optional file must not abort the install */
            }),
          ),
        );
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("mnexus-") && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // Ask the page to re-evaluate its "online" state.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) c.postMessage({ type: "mnexus-sw-activated", version: VERSION });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache the API. Mutations are handled by the outbox.
  if (url.pathname.startsWith("/api/")) return;

  // WebSocket upgrades must not be intercepted.
  if (req.headers.get("upgrade") === "websocket") return;

  // ---- Navigation: network-first, fall back to cached shell ----
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match("./index.html")) ||
            (await cache.match("./")) ||
            new Response(
              "<!doctype html><meta charset=utf-8>" +
                "<title>M-NEXUS — offline</title>" +
                "<body style='font:16px system-ui;padding:2rem;background:#0b0b12;color:#f4f4f8'>" +
                "<h1>M-NEXUS</h1><p>Sin conexión y sin copia local. " +
                "Reconéctate una vez para instalar la app.</p>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }
      })(),
    );
    return;
  }

  // ---- Static assets: stale-while-revalidate ----
  if (url.origin === self.location.origin && STATIC_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200 && resp.type === "basic") {
              cache.put(req, resp.clone());
            }
            return resp;
          })
          .catch(() => null);
        if (cached) {
          // Refresh in the background; return the cached copy immediately.
          network;
          return cached;
        }
        const fresh = await network;
        if (fresh) return fresh;
        const shell = await caches.open(SHELL_CACHE);
        return shell.match(req) || new Response("", { status: 504, statusText: "Offline" });
      })(),
    );
  }
});

/* ============================================================
 * Background Sync — flush the IndexedDB outbox when we get network.
 * ============================================================ */
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of clients) {
          c.postMessage({ type: "mnexus-sync-request" });
        }
      })(),
    );
  }
});

/* Page asks us to register a background sync for the next reconnect. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "mnexus-register-sync" && self.registration.sync) {
    self.registration.sync
      .register(SYNC_TAG)
      .catch(() => { /* Background Sync unsupported — the online listener covers it */ });
  }
  if (data.type === "mnexus-skip-waiting") {
    self.skipWaiting();
  }
  if (data.type === "mnexus-get-version" && event.source) {
    event.source.postMessage({ type: "mnexus-sw-version", version: VERSION });
  }
});
