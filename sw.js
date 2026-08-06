/* ============================================================
   Early — Service Worker
   Uygulamayı ana ekrana eklenen bağımsız (standalone) bir uygulama
   gibi çalıştırmak ve çevrimdışı erişimi sağlamak için basit bir
   "app shell" önbellekleme stratejisi kullanır.

   Sürüm numarasını (CACHE_VERSION) her index.html güncellemesinde
   artırman, kullanıcıların eski önbellekte takılı kalmadan yeni
   sürümü almasını sağlar. Uygulama içinde bu durum zaten
   "Yeni bir sürüm hazır" bandı ile kullanıcıya soruluyor.
   ============================================================ */
const CACHE_VERSION = 'early-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  // Yeni service worker'ın hemen "waiting" durumuna geçmesini sağlar;
  // aktivasyonu index.html'deki "Yenile" butonu (SKIP_WAITING mesajı) tetikler.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Kullanıcı "Yenile" butonuna bastığında index.html tarafından gönderilir.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* Strateji:
   - Sayfa navigasyonları (HTML): önce ağ, olmazsa önbellekten app shell.
     Böylece kullanıcı çevrimiçiyken her zaman en güncel index.html'i alır,
     çevrimdışıyken de uygulama açılmaya devam eder.
   - Diğer her şey (font, ikon, statik dosyalar): önce önbellek, olmazsa ağ,
     başarılı ağ isteklerini de önbelleğe ekler (stale-while-revalidate benzeri). */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (!isSameOrigin) {
    // Google Fonts, gsi/client vb. üçüncü taraf istekler: ağı dene, olmazsa
    // önbellekte varsa onu döndür; yoksa hata normal şekilde yansır.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
