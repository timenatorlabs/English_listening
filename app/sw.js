// Service worker: app shell is network-first (so updates arrive), audio is cache-first.
const SHELL_CACHE = "shell-v12";
const AUDIO_CACHE = "audio-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "fonts/noto-sans-jp.css",
  "app.js",
  "db.js",
  "guides.js",
  "util.js",
  "audio.js",
  "dictation.js",
  "connected.js",
  "shadowing.js",
  "extensive.js",
  "progress.js",
  "charts.js",
  "scoring.js",
  "metrics.js",
  "stress.js",
  "reading.js",
  "vocab.js",
  "data/chants.json",
  "data/stories.json",
  "data/ngsl.json",
  "data/stress.json",
  "data/rhythm.json",
  "data/dictation.json",
  "data/extensive.json",
  "data/connected.json",
  "data/shadowing.json",
  "manifest.webmanifest",
  "data/contrasts.json",
  "data/rl.json",
  "data/bv.json",
  "data/sth.json",
  "data/aeuh.json",
  "data/iih.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.url.includes("/audio/")) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))),
  );
});
