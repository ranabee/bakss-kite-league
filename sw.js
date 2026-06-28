/* ============================================================
   BAKSS Kite League Manager — Service Worker
   Cache-first for assets, network-first for API/auth
   ============================================================ */

const CACHE_NAME   = 'bakss-v2.0.0';
const STATIC_CACHE = 'bakss-static-v2.0.0';

// Assets to precache
const PRECACHE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Network-first patterns (don't cache API calls)
const NETWORK_FIRST = [
  'supabase.co',
  'supabase.io',
  'stripe.com',
];

// ============================================================
// INSTALL — Precache static assets
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — Clean old caches
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(name => name !== CACHE_NAME && name !== STATIC_CACHE)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — Cache strategy
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension, etc.
  if (!url.protocol.startsWith('http')) return;

  // Network-first for API calls
  const isAPI = NETWORK_FIRST.some(host => url.hostname.includes(host));
  if (isAPI) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for static assets
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback
    const fallback = await caches.match('./index.html');
    return fallback || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'BAKSS Kite League';
  const options = {
    body: data.body || 'You have a new notification',
    icon: './icons/icon-192.png',
    badge: './icons/icon-72.png',
    tag: data.tag || 'bakss-notif',
    data: { url: data.url || './' },
    vibrate: [100, 50, 100],
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        for (const client of windowClients) {
          if (client.url === url && 'focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
