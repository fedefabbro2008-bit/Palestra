// Giardino · service worker: l'app si apre subito, anche con la rete lenta o senza rete.
// Pagina e file arrivano dalla copia salvata sul telefono; intanto, in sottofondo, si scarica quella del sito e si aggiorna
// la copia. Se è una versione nuova (una pubblicazione) l'app viene avvisata e si ricarica: subito se l'hai appena aperta e
// non l'hai ancora toccata, altrimenti la prossima volta che ci torni. Prima aveva la precedenza la rete: a ogni apertura
// si aspettava il sito (fino a 3 secondi con la rete lenta). La prima volta, senza copia, si usa la rete.
// Tutto il resto (dati /api, connettore /mcp, altri indirizzi) non passa dal service worker.
const CACHE = 'giardino-v3';
const STATICI = ['/manifest.webmanifest', '/icona-192.png', '/icona-512.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', ...STATICI])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });

const buona = (r) => r.ok && r.type === 'basic' && !r.redirected;
// versione della pagina: l'impronta che giardino/build-app.mjs scrive nella pagina; senza (pagine vecchie) il testo intero
const impronta = (t) => (/<meta name="giardino-build" content="(\w+)">/.exec(t) || [])[1];
const diversa = (a, b) => { const x = impronta(a), y = impronta(b); return x && y ? x !== y : a !== b; };
// avvisa le finestre dell'app; quella appena aperta può non esserci ancora: riprova per 3 secondi
async function avvisa() {
  for (let i = 0; i < 7; i++) {
    const finestre = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (finestre.length) return finestre.forEach((c) => c.postMessage({ tipo: 'nuova-versione' }));
    await new Promise((r) => setTimeout(r, 500));
  }
}
// la pagina del sito in sottofondo, una sola volta anche se la chiedono in due (l'apertura e il controllo di Chrome)
let inCorso = null;
async function aggiornaPagina(cache) {
  const r = await fetch(new Request('/', { cache: 'no-cache', credentials: 'same-origin' }));
  if (!buona(r)) return;
  // stessa pagina di prima (stessa etichetta «etag» del sito): niente da leggere né da riscrivere. Prima, a ogni apertura,
  // si rileggevano le due pagine intere (370 KB l'una) e si riscriveva la copia sul telefono, anche senza novità.
  const copia = await cache.match('/'), etag = r.headers.get('etag');
  if (etag && copia && copia.headers.get('etag') === etag) return;
  const prima = await copia?.text(), ora = await r.clone().text();
  await cache.put('/', r);
  if (prima != null && diversa(prima, ora)) await avvisa();
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const pagina = u.pathname === '/' || u.pathname === '/index.html';
  if (!pagina && !STATICI.includes(u.pathname)) return;
  const chiave = pagina ? '/' : u.pathname;
  const lavoro = (async () => {
    const cache = await caches.open(CACHE), copia = await cache.match(chiave);
    if (!copia) {   // prima volta: dalla rete, e la copia per la prossima
      const r = await fetch(pagina ? new Request('/', { cache: 'no-cache', credentials: 'same-origin' }) : e.request);
      return { risposta: r, dopo: buona(r) ? cache.put(chiave, r.clone()) : null };
    }
    const dopo = pagina ? (inCorso ||= aggiornaPagina(cache).finally(() => { inCorso = null; }))
      : fetch(e.request).then((r) => buona(r) && cache.put(chiave, r));
    return { risposta: copia, dopo };
  })();
  // risposta e lavoro in sottofondo chiesti subito (Safari non accetta waitUntil dopo un'attesa); qualunque problema: la rete
  e.respondWith(lavoro.then((x) => x.risposta, () => fetch(e.request)));
  e.waitUntil(lavoro.then((x) => x.dopo).catch(() => {}));
});
