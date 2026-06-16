// BAKSS Kite Manager - Service Worker
// VERSION: 1.0.9
// Increment VERSION on every deploy to force all clients to update immediately
const VERSION = '1.0.9';
const CACHE_NAME = 'bakss-kite-' + VERSION;

// On install: activate immediately, don't wait
self.addEventListener('install', event => {
  console.log('[SW] Installing version', VERSION);
  self.skipWaiting(); // Take control immediately, don't wait for old SW to die
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['./manifest.json']))
  );
});

// On activate: delete ALL old caches, claim all clients immediately
self.addEventListener('activate', event => {
  console.log('[SW] Activating version', VERSION, '- clearing old caches');
  event.waitUntil(
    Promise.all([
      // Delete every cache that isn't this version
      caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )),
      // Take control of all open tabs immediately
      self.clients.claim().then(() => {
        // Tell all clients to reload so they get fresh content
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_UPDATED', version: VERSION });
          });
        });
      })
    ])
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never intercept: Supabase, realtime, CDN scripts
  if (url.includes('supabase') || url.includes('realtime') ||
      url.includes('jsdelivr') || url.includes('cdn.')) {
    return; // Pass through to network
  }

  // HTML documents: ALWAYS network first, never serve stale HTML
  if (event.request.destination === 'document' ||
      url.endsWith('.html') || url.endsWith('/') ||
      url === self.location.origin + '/') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: cache first (manifest, icons etc)
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
