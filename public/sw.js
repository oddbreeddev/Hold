const CACHE_NAME = 'hold-v4';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.svg',
  '/index.css',
  '/index.tsx',
  '/App.tsx',
  '/types.ts',
  '/types',
  '/services/AudioEngine.ts',
  '/services/AudioEngine',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700&family=Unbounded:wght@400;900&display=swap',
  'https://cdn.tailwindcss.com',
  'https://esm.sh/react@^19.2.4',
  'https://esm.sh/react-dom@^19.2.4'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use allSettled to ensure installation continues even if some assets fail
      return Promise.allSettled(
        PRECACHE_ASSETS.map(asset => cache.add(asset))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Whitelist cross-origin requests for critical assets
  const isWhitelisted = 
    event.request.url.startsWith(self.location.origin) || 
    event.request.url.includes('fonts.googleapis.com') || 
    event.request.url.includes('fonts.gstatic.com') ||
    event.request.url.includes('cdn.tailwindcss.com') ||
    event.request.url.includes('esm.sh');

  if (!isWhitelisted) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        // Cache successful responses (including opaque cross-origin ones)
        if (response && (response.status === 200 || response.type === 'opaque')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
