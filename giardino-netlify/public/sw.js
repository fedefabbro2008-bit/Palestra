// Giardino · service worker: l'app si apre anche senza rete o con rete lenta.
// Pagina e file: prima la rete (così arriva subito la versione nuova); se non risponde entro 3 secondi, la copia salvata
// (la rete intanto continua e aggiorna la copia per la prossima apertura); senza rete, la copia salvata.
// I dati (/api) e il connettore (/mcp) non passano mai dalla cache: offline l'app usa i dati salvati sul telefono.
const CACHE = 'giardino-v2', ATTESA = 3000;
const FILE = ['/', '/manifest.webmanifest', '/icona-192.png', '/icona-512.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/mcp')) return;
  const rete = fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); e.waitUntil(caches.open(CACHE).then((x) => x.put(e.request, c))); } return r; });
  const copia = () => caches.match(e.request).then((r) => r || caches.match('/'));
  e.respondWith(new Promise((fine) => {
    let dato = false; const dai = (r) => { if (r && !dato) { dato = true; fine(r); } };
    const t = setTimeout(() => copia().then(dai), ATTESA);
    rete.then((r) => { clearTimeout(t); dai(r); }).catch(() => { clearTimeout(t); copia().then((r) => dai(r || Response.error())); });
  }));
  e.waitUntil(rete.catch(() => {}));
});
