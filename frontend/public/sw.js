const CACHE = 'packtrack-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/offline.html')));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// For navigation requests: try network, fall back to offline page.
// All other requests (API, assets) pass through to network normally.
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
  }
});
