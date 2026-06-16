// v7 - network-first for HTML, cache-first for assets
const CACHE_NAME = 'bakss-kite-v7';
const CACHE_ASSETS = ['./manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // Skip supabase/realtime - always network
  if (url.includes('supabase') || url.includes('realtime') || url.includes('jsdelivr')) {
    return;
  }
  
  // HTML files: NETWORK FIRST (always get latest version)
  if (event.request.destination === 'document' || 
      url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  
  // Everything else: cache first
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
