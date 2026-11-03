// Giardino · service worker: l'app si apre anche senza rete.
// Pagina e file: prima la rete (così arriva subito la versione nuova), altrimenti la copia salvata.
// I dati (/api) e il connettore (/mcp) non passano mai dalla cache: offline l'app usa i dati salvati sul telefono.
const CACHE = 'giardino-v1';
const FILE = ['/', '/manifest.webmanifest', '/icona-192.png', '/icona-512.png', '/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/mcp')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
