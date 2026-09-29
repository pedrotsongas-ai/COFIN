const CACHE = 'cofin-v3';
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

// Rede primeiro, cache só como reserva (offline). Assim, quando o app é atualizado, a versão nova
// aparece na hora — em vez de ficar preso numa cópia antiga guardada no celular.
// Só se aplica a pedidos do próprio site; chamadas pra fora (OneDrive, proxies) e as functions
// da Netlify passam direto, sem o service worker interferir nem guardar nada.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() =>
        caches.match(e.request)
          .then((cached) => cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
          .then((r) => r || Response.error())
      )
  );
});
