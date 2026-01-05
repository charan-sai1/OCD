// Service worker for caching and background processing
const CACHE_NAME = 'ocd-cache-v1';
const THUMBNAIL_CACHE = 'thumbnails-cache-v1';

// Install event - cache essential resources
self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        // Add other essential assets
      ]);
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== THUMBNAIL_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - only cache specific assets, don't interfere with app loading
self.addEventListener('fetch', (event: any) => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip service worker for main app files to prevent conflicts
  if (url.pathname === '/' ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.html') ||
      url.hostname !== location.hostname) { // Skip cross-origin requests
    return; // Let the browser handle these normally
  }

  // Handle thumbnail requests specially
  if (url.protocol === 'asset:' || url.pathname.includes('thumbnail')) {
    event.respondWith(
      caches.open(THUMBNAIL_CACHE).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            console.log('Serving thumbnail from cache:', url.pathname);
            return response;
          }

          console.log('Fetching thumbnail from network:', url.pathname);
          return fetch(event.request).then((response) => {
            // Only cache if response is successful AND contains image data, not HTML error pages
            if (response.ok) {
              const contentType = response.headers.get('content-type');
              if (contentType && contentType.startsWith('image/')) {
                cache.put(event.request, response.clone());
              } else if (contentType && contentType.includes('text/html')) {
                // Don't cache HTML error responses - return 404 instead
                console.warn('Received HTML response for image request, not caching:', url.pathname);
                return new Response('', { status: 404 });
              }
            }
            return response;
          }).catch((error) => {
            console.warn('Failed to fetch thumbnail:', error);
            return new Response('', { status: 404 });
          });
        });
      }).catch((error) => {
        console.error('Cache error:', error);
        return fetch(event.request);
      })
    );
    return;
  }

  // For other requests, just pass through without caching
  return;
});

// Background sync for directory scanning
self.addEventListener('sync', (event: any) => {
  if (event.tag === 'background-directory-scan') {
    event.waitUntil(doBackgroundDirectoryScan());
  }
});

async function doBackgroundDirectoryScan() {
  // This would be called when the app is backgrounded
  // Could pre-scan directories or update caches
  console.log('Background directory scan triggered');
}

// Message handling for communication with main thread
self.addEventListener('message', (event: any) => {
  const { type, data } = event.data;

  switch (type) {
    case 'CACHE_THUMBNAIL':
      cacheThumbnail(data.imagePath, data.thumbnail);
      break;
    case 'GET_CACHED_THUMBNAIL':
      getCachedThumbnail(data.imagePath).then((thumbnail) => {
        event.ports[0].postMessage({ thumbnail });
      });
      break;
    case 'CLEAR_CACHE':
      clearCache();
      break;
  }
});

async function cacheThumbnail(imagePath: string, thumbnail: string) {
  const cache = await caches.open(THUMBNAIL_CACHE);
  const request = new Request(`thumbnail://${imagePath}`);
  const response = new Response(thumbnail);
  await cache.put(request, response);
}

async function getCachedThumbnail(imagePath: string): Promise<string | null> {
  const cache = await caches.open(THUMBNAIL_CACHE);
  const request = new Request(`thumbnail://${imagePath}`);
  const response = await cache.match(request);

  if (response) {
    return await response.text();
  }

  return null;
}

async function clearCache() {
  await Promise.all([
    caches.delete(CACHE_NAME),
    caches.delete(THUMBNAIL_CACHE),
  ]);
}