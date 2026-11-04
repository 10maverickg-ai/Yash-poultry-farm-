/* Service worker for the Yash Poultry Farm website. Deliberately small and safe.
 *
 * It keeps ONE thing on the phone: the static app shell (the offline page, the icons, and the built script / style / font files, which are
 * the same for everybody and hold no farm data). It NEVER stores a page, an API answer, a form post or anything behind the login, so a
 * shared phone can never show farm data from a cache after logout.
 *
 * Pages always come from the network. If the network is down, a page request is answered with /offline.html.
 * The cache name carries the version of the app (the "v" in this file's own address), so every new deployment installs a fresh cache
 * and deletes the old ones.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = "ypf-static-" + VERSION;
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("ypf-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(woff2?|ttf|otf)$/i.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // forms, uploads, server actions: always straight to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // a page: network only; if that fails, the offline page
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((c) => c.match("/offline.html")).then((r) => r || new Response("No connection. Your data is safe. Try again when you are online.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } })))
    );
    return;
  }

  // built files and icons: cached copy first (their names change when their content changes), else the network, then keep a copy
  if (isStatic(url)) {
    event.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.type === "basic") c.put(req, res.clone());
              return res;
            })
        )
      )
    );
  }
  // everything else (data, API, page fragments): not touched, never cached
});
