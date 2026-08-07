/* ============================================================
   Early — Service Worker
   Uygulama kabuğunu (index.html + ikonlar + manifest) önbelleğe
   alarak çevrimdışı açılışı ve hızlı yüklemeyi sağlar.
   Google kimlik doğrulama / Drive API çağrılarına DOKUNMAZ —
   bunlar her zaman ağdan gider, uygulama zaten bu isteklerin
   başarısız olma ihtimalini kendi içinde (try/catch) yönetiyor.
   ============================================================ */
const CACHE_VERSION = 'early-2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Bu SW'nin bulunduğu dizine göre göreli yollar — uygulama bir alt
// klasörden servis edilse bile doğru çalışır.
const SCOPE_URL = new URL(self.registration ? self.registration.scope : self.location.href);
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './sounds/rain-light.m4a',
  './sounds/rain-long.m4a',
  './sounds/rain-forest.m4a'
].map(p => new URL(p, self.location.href).toString());

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // allSettled: tek bir dosya (ör. bir ikon eksikse) tüm kurulumu düşürmesin
    await Promise.allSettled(SHELL_URLS.map(url => cache.add(new Request(url, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('early-') && !k.startsWith(CACHE_VERSION))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Kullanıcı isterse "Yeni sürüm" bildirimini görmeden hemen güncellemeyi
// uygulaması için sayfa tarafından postMessage({type:'SKIP_WAITING'}) gönderilebilir.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isGoogleAuthOrApi(url) {
  return url.hostname === 'accounts.google.com' ||
         url.hostname === 'www.googleapis.com' ||
         url.hostname === 'oauth2.googleapis.com';
}

function isGoogleFont(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  return cached || (await networkPromise) || Response.error();
}

async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('./index.html', response.clone());
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match('./index.html', { ignoreSearch: true }) ||
                    await cache.match(new URL('./index.html', self.location.href).toString());
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PATCH (Drive upload vb.) her zaman doğrudan ağa gider

  const url = new URL(req.url);

  // Google girişi ve Drive/oauth API çağrıları: hiç dokunma, SW devreye girmesin.
  if (isGoogleAuthOrApi(url)) return;

  // Sayfa navigasyonu (uygulamayı açma / yenileme): ağ önce, olmazsa önbellekteki kabuk.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstShell(req));
    return;
  }

  // Google Fonts: stale-while-revalidate — hızlı açılış + arka planda güncel kalır.
  if (isGoogleFont(url)) {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  // Aynı origin'deki uygulama dosyaları (manifest, ikonlar, bu sw.js dahil değil): cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Diğer her şey (ör. üçüncü taraf CDN varsa): ağ, olmazsa varsa runtime önbellekten dene.
  event.respondWith((async () => {
    try {
      const response = await fetch(req);
      if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, response.clone());
      }
      return response;
    } catch (e) {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      throw e;
    }
  })());
});

/* ============================================================
   PUSH BİLDİRİMLERİ
   Uygulama tamamen kapalı/arka planda olsa bile, backend sunucu
   bir push mesajı gönderdiğinde bu event tetiklenir ve bildirim
   gösterilir — sayfa hiç çalışmıyor olsa bile.
   ============================================================ */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Early', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Early';
  const options = {
    body: data.body || '',
    tag: data.tag || 'early-push',
    icon: new URL('./icons/icon-192.png', self.location.href).toString(),
    badge: new URL('./icons/icon-192.png', self.location.href).toString(),
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Bildirime dokununca uygulamayı aç / öne getir.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
