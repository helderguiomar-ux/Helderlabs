const CACHE_NAME = 'hccall-pwa-v1';
const STATIC_ASSETS = [
  '/hccall.html',
  '/hccall.webmanifest',
  '/assets/css/app.css',
  '/assets/js/modules.js',
  '/locales/pt.json',
  '/locales/en.json',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Do not intercept API requests (handled via IndexedDB queue in app)
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => caches.match('/hccall.html'));
    })
  );
});
