/* Palestra · service worker: l'app si apre anche senza campo.
   - la pagina arriva dalla rete; se la rete non risponde entro 3 s (o non c'è) si usa la copia salvata
   - ogni volta che la rete risponde la copia salvata si aggiorna: nessun bisogno di cambiare questo file
   - /api/ (sincronizzazione) mai in copia: sono i tuoi dati, devono essere sempre freschi */
const CACHE = 'palestra-v1';
const PAGE = './index.html';

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE)
    .then(c=> fetch(PAGE, {cache:'reload'}).then(r=>{ if(r.ok) return Promise.all([c.put(PAGE, r.clone()), c.put('./', r)]); }))
    .catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys()
    .then(ks=> Promise.all(ks.filter(k=> k.startsWith('palestra-') && k!==CACHE).map(k=> caches.delete(k))))
    .then(()=> self.clients.claim()));
});

function fromCache(req){
  return caches.open(CACHE).then(c=> c.match(req, {ignoreSearch:true}).then(r=> r || (req.mode==='navigate' ? c.match(PAGE).then(p=> p || c.match('./')) : undefined)));
}
function save(req, resp){
  if(resp && resp.ok && resp.type==='basic'){
    const copy = resp.clone(), copy2 = req.mode==='navigate' ? resp.clone() : null;
    caches.open(CACHE).then(c=>{ c.put(req, copy); if(copy2) c.put(PAGE, copy2); }).catch(()=>{});
  }
  return resp;
}
self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(new Promise(resolve=>{
    let done = false;
    const finish = r=>{ if(!done && r){ done = true; resolve(r); } };
    const net = fetch(req).then(r=> save(req, r));
    // rete lenta (palestra sotto terra): dopo 3 s la copia salvata, se c'è; la rete intanto aggiorna la copia
    const t = setTimeout(()=> fromCache(req).then(finish), 3000);
    net.then(r=>{ clearTimeout(t); if(r.ok || !done) finish(r); })
       .catch(()=>{ clearTimeout(t); fromCache(req).then(r=> finish(r || Response.error())); });
  }));
});
