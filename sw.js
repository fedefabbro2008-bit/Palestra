/* Palestra · service worker: l'app si apre sempre subito, con o senza campo.
   - la pagina arriva dalla copia salvata sul telefono (niente attese, anche con rete lentissima in palestra);
     intanto, se c'è rete, si scarica la versione pubblicata: se è cambiata si salva e la pagina mostra
     «Nuova versione · Aggiorna» (altrimenti la si vede alla prossima apertura)
   - prima apertura (nessuna copia): dalla rete, e da lì si salva
   - caratteri: salvati all'installazione, poi sempre dalla copia (il nome cambia se cambiano)
   - /api/ e /mcp (sincronizzazione, Claude) mai in copia: sono i tuoi dati, devono essere sempre freschi */
const CACHE = 'palestra-v1';
const PAGE = './index.html';
// caratteri dell'app (file a parte, nome con l'impronta del contenuto: non cambiano mai)
const FONTS = ['./fonts/space-grotesk-600.e0dc4433.woff2', './fonts/space-grotesk-700.4d117949.woff2', './fonts/jetbrains-mono-500.b392a220.woff2', './fonts/jetbrains-mono-700.f677c52d.woff2', './fonts/inter-400.03f3afb5.woff2', './fonts/inter-500.07516f15.woff2', './fonts/inter-600.e014be68.woff2'];
const NET_WAIT = 3000;   // altre richieste: oltre questo tempo si usa la copia, se c'è

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE)
    .then(c=> Promise.all([
      fetch(PAGE, {cache:'reload'}).then(r=>{ if(r.ok) return Promise.all([c.put(PAGE, r.clone()), c.put('./', r)]); }),
      c.addAll(FONTS).catch(()=>{})   // se non riesce ora, si salvano al primo uso
    ]))
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

/* pagina: dalla copia, e in sottofondo la versione pubblicata. Se è diversa da quella salvata la si salva
   (pagina e "./") e si avvisa la finestra che l'ha chiesta. Si chiede al server se è cambiata, con l'impronta della
   copia (If-None-Match): se è la stessa risponde 304 senza contenuto, così a ogni apertura non si riscaricano i
   ~750 KB della pagina (prima sì, sempre) */
function refreshPage(req, cached){
  const tag = cached.headers.get('etag');
  return fetch(req.url, { cache:'no-store', credentials:'same-origin', headers: tag ? { 'If-None-Match': tag } : {} }).then(r=>{
    if(r.status===304 || !r.ok || r.type!=='basic') return;   // 304: uguale a quella salvata, niente scaricato
    return Promise.all([r.clone().text(), cached.text()]).then(([nu, old])=>{
      if(nu===old) return;
      return caches.open(CACHE).then(c=> Promise.all([c.put(PAGE, r.clone()), c.put('./', r.clone()), c.put(req, r)]))
        .then(()=> self.clients.matchAll({ type:'window' }))
        .then(list=> list.forEach(w=> w.postMessage({ type:'palestra-nuova-versione' })));
    });
  }).catch(()=>{});
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.origin!==self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) return;
  // caratteri: prima la copia salvata (non cambiano mai), la rete solo se manca
  if(url.pathname.indexOf('/fonts/')>=0){
    e.respondWith(caches.open(CACHE).then(c=> c.match(req).then(hit=> hit || fetch(req).then(r=>{ if(r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  // la pagina: subito dalla copia, aggiornata in sottofondo
  if(req.mode==='navigate'){
    e.respondWith(fromCache(req).then(hit=>{
      if(hit){ e.waitUntil(refreshPage(req, hit.clone())); return hit; }   // copia letta prima che la pagina la consumi
      return fetch(req).then(r=> save(req, r));   // prima volta: dalla rete
    }).catch(()=> fetch(req)));
    return;
  }
  // il resto: dalla rete; se è lenta (oltre 3 s), dà errore o non c'è, la copia salvata
  e.respondWith(new Promise(resolve=>{
    let done = false;
    const finish = r=>{ if(!done && r){ done = true; resolve(r); } };
    const net = fetch(req).then(r=> save(req, r));
    const t = setTimeout(()=> fromCache(req).then(finish, ()=>{}), NET_WAIT);
    net.then(r=>{ clearTimeout(t); if(r.ok) finish(r); else if(!done) fromCache(req).then(c=> finish(c || r), ()=> finish(r)); })
       .catch(()=>{ clearTimeout(t); fromCache(req).then(r=> finish(r || Response.error()), ()=> finish(Response.error())); });
  }));
});
