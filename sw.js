// ══════════════════════════════════════════════════
//   LathePro Service Worker
//   Amar Furniture — AppCentrik
//   Version: 1.1.1
// ══════════════════════════════════════════════════

const APP_VERSION = '1.1.1';
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
// Quote photos live in Firebase Storage. Download URLs are immutable (new upload = new URL), so
// they're cached forever in their own cache that survives app updates.
const PHOTO_CACHE = 'lathepro-photos';
const STORAGE_HOST = 'firebasestorage.googleapis.com';
const NAV_TIMEOUT_MS = 4000;

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
          .filter(key => key !== CACHE_NAME && key !== PHOTO_CACHE)
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

  // Quote photos — cache first. Fetched in CORS mode so the same cached copy serves <img> tags
  // and the PDF generator's fetch(); falls back to a plain request if CORS isn't available.
  if (url.hostname === STORAGE_HOST && url.searchParams.get('alt') === 'media') {
    event.respondWith(
      caches.open(PHOTO_CACHE).then(async cache => {
        const hit = await cache.match(event.request.url);
        if (hit) return hit;
        try {
          const res = await fetch(event.request.url, { mode: 'cors', credentials: 'omit' });
          if (res.ok) cache.put(event.request.url, res.clone());
          return res;
        } catch (e) {
          return fetch(event.request);
        }
      })
    );
    return;
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

  // For app shell (HTML, manifest, sw.js) — network first, fallback to cache.
  // Page loads give the network NAV_TIMEOUT_MS so a weak signal doesn't leave a blank screen.
  const raw = fetch(event.request);
  raw.catch(() => {});
  const network = event.request.mode === 'navigate'
    ? Promise.race([
        raw,
        new Promise((_, reject) => setTimeout(() => reject(new Error('nav timeout')), NAV_TIMEOUT_MS)),
      ])
    : raw;
  event.respondWith(
    network
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
        }).then(r => r || raw); // nothing cached yet (first visit): keep waiting for the network
      })
  );
});

// ── MESSAGE: force update from app ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
