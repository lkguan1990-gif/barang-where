// Barang Where — service worker
// Minimal, deliberately simple: enough for installability (required for
// TWA/Play Store) and basic offline resilience, without trying to cache
// live Supabase data (that would go stale immediately and isn't the point
// here — the goal is "the app shell loads even with a flaky connection").
//
// v2: switched from cache-first to network-first for all requests, not
// just navigations. Cache-first on JS/CSS meant a stale cached app.js
// could silently keep running after a real code update — exactly what
// happened after the sign-in rename. Network-first fixes that: always
// fresh when online, cache only kicks in as a fallback when offline.

const CACHE_NAME = 'barang-where-v2';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Network-first for everything: always try to get the current version
  // first. Only fall back to whatever's cached if the network fails
  // (genuinely offline), and keep the cache updated with each successful
  // fetch so the offline fallback doesn't go stale either.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});

