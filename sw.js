// ══════════════════════════════════════════════════
//   LathePro Service Worker
//   Amar Furniture — AppCentrik
//   Version: 1.0.30
// ══════════════════════════════════════════════════

const APP_VERSION = '1.0.30';
const CACHE_NAME = 'lathepro-v' + APP_VERSION;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  // Firebase SDK — without these cached the app can't start offline
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js',
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'www.gstatic.com'];

// ── INSTALL: cache all static assets ──
self.addEventListener('install', event => {
  console.log('[SW] Installing LathePro v' + APP_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
        )
      );
    })
  );
  self.skipWaiting(); // activate immediately
});

// ── ACTIVATE: remove old caches ──
self.addEventListener('activate', event => {
  console.log('[SW] Activating LathePro v' + APP_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim(); // take control of all open tabs
});

// ── FETCH: network-first for Firebase, cache-first for static ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Firebase / Firestore / Auth — always go to network
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebaseio.com')
  ) {
    return; // let browser handle normally
  }

  // For Google Fonts (CSS) — network first, fallback to cache
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For versioned CDN assets (jsPDF, Firebase SDK) — cache first, update in background
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          // <script> tags fetch cross-origin as no-cors, giving 'opaque' responses (status 0)
          if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone(); // clone before the body is consumed
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // For app shell (HTML, manifest, sw.js) — network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(event.request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          // If no cache and offline, return the main app shell
          return caches.match('/').then(r => r || caches.match('/index.html'));
        });
      })
  );
});

// ── MESSAGE: force update from app ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
