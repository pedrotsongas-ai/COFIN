const CACHE = 'cofin-v2';
const ASSETS = ['./index.html', './manifest.json'];

// Cada arquivo é guardado separadamente: se um deles falhar, os outros continuam e a instalação
// do service worker NÃO é cancelada (um service worker que falha ao instalar impede o Chrome
// de oferecer a opção "Instalar app").
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(ASSETS.map((url) => c.add(url).catch((err) => console.warn('SW: não consegui guardar em cache', url, err))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Stale-while-revalidate: responde rápido do cache e atualiza em segundo plano.
// Só se aplica a pedidos do próprio site — chamadas pra fora (OneDrive, proxies de sincronização
// etc.) passam direto, sem o Service Worker interferir nem tentar cachear.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const buscarEAtualizar = fetch(e.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => cached || Response.error());
      return cached || buscarEAtualizar;
    })
  );
});
