// Offline cache. Cache-first for the app shell; bump VERSION on every release.
const VERSION = 'mq-v1.0.2';
const PRECACHE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/parse.js', './js/dates.js', './js/format.js', './js/game.js', './js/projection.js',
  './js/charts.js', './js/icons.js', './js/store.js',
  './vendor/xlsx.full.min.js',
  './fonts/space-grotesk-latin-500-normal.woff2', './fonts/space-grotesk-latin-600-normal.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
