const CACHE_NAME = 'hold-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.svg',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700&family=Unbounded:wght@400;900&display=swap',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
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
  // Skip cross-origin requests unless they are for fonts, tailwind, or picsum
  if (!event.request.url.startsWith(self.location.origin) && 
      !event.request.url.includes('fonts.googleapis.com') && 
      !event.request.url.includes('fonts.gstatic.com') &&
      !event.request.url.includes('cdn.tailwindcss.com') &&
      !event.request.url.includes('picsum.photos')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        // Check if we received a valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          // For cross-origin assets like fonts/tailwind/picsum, type might be 'opaque'
          if (event.request.url.includes('fonts') || 
              event.request.url.includes('tailwind') ||
              event.request.url.includes('picsum')) {
             // We still want to cache these
          } else {
            return response;
          }
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // If fetch fails (offline) and not in cache, try to return index.html for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
