// Offline support: the app shell is cached so Quicksnap opens without a
// network. Recordings live in browser storage and never touch this cache.
const CACHE = "quicksnap-v2";
const SHELL = ["/", "/app/", "/manifest.webmanifest", "/icon.svg", "/favicon.ico"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            // Navigation preload starts the page request while the worker boots,
            // so a cold service worker never delays the first paint.
            .then(() => self.registration.navigationPreload?.enable())
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== location.origin) return;

    // Hashed build assets never change: cache first.
    if (url.pathname.startsWith("/assets/")) {
        e.respondWith(
            caches.match(req).then(
                (hit) =>
                    hit ||
                    fetch(req).then((res) => {
                        if (res.ok) {
                            const copy = res.clone();
                            caches.open(CACHE).then((c) => c.put(req, copy));
                        }
                        return res;
                    }),
            ),
        );
        return;
    }

    // Pages: network first so deploys show up, cache as the offline fallback.
    if (req.mode === "navigate") {
        e.respondWith(
            Promise.resolve(e.preloadResponse)
                .then((pre) => pre || fetch(req))
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(url.pathname, copy));
                    return res;
                })
                .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/app/"))),
        );
    }
});
