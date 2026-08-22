// Barang Where — service worker
// Minimal, deliberately simple: enough for installability (required for
// TWA/Play Store) and basic offline resilience, without trying to cache
// live Supabase data (that would go stale immediately and isn't the point
// here — the goal is "the app shell loads even with a flaky connection").

const CACHE_NAME = 'barang-where-v1';
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

  // Navigations (loading the app itself): try the network first, so you
  // always get the current code and aren't stuck on a stale cached version.
  // Only fall back to the cached shell if genuinely offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else (CSS/JS/icons): cache-first for speed, falling back
  // to the network if it's not already cached.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
