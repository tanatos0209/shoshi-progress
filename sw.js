const CACHE = "shoshi-progress-v8";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css?v=8",
  "./js/rules.js?v=8",
  "./js/pcs.js?v=8",
  "./js/app.js?v=8",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./favicon-32.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      if (fresh && fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return fresh;
      }
    } catch (err) {
      /* offline or a navigation fetch Safari rejects */
    }
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === "navigate") {
      const shell = await caches.match("./index.html");
      if (shell) return shell;
    }
    return new Response("", { status: 504, statusText: "Offline" });
  })());
});
