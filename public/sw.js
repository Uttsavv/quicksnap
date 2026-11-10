// Offline support: the app shell is cached so Quicksnap opens without a
// network. Recordings live in browser storage and never touch this cache.
const CACHE = "quicksnap-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/favicon.ico"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put("/", copy));
                    return res;
                })
                .catch(() => caches.match("/")),
        );
    }
});
