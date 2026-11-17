/* Palestra · service worker: l'app si apre anche senza campo.
   - la pagina arriva dalla rete; se la rete non risponde entro 3 s (o non c'è) si usa la copia salvata
   - ogni volta che la rete risponde la copia salvata si aggiorna: nessun bisogno di cambiare questo file
   - /api/ (sincronizzazione) mai in copia: sono i tuoi dati, devono essere sempre freschi */
const CACHE = 'palestra-v1';
const PAGE = './index.html';
// caratteri dell'app (file a parte, nome con l'impronta del contenuto: non cambiano mai)
const FONTS = ['./fonts/space-grotesk-600.e0dc4433.woff2', './fonts/space-grotesk-700.4d117949.woff2', './fonts/jetbrains-mono-500.b392a220.woff2', './fonts/jetbrains-mono-700.f677c52d.woff2', './fonts/inter-400.03f3afb5.woff2', './fonts/inter-500.07516f15.woff2', './fonts/inter-600.e014be68.woff2'];

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
self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.origin!==self.location.origin || url.pathname.startsWith('/api/')) return;
  // caratteri: prima la copia salvata (non cambiano mai), la rete solo se manca
  if(url.pathname.indexOf('/fonts/')>=0){
    e.respondWith(caches.open(CACHE).then(c=> c.match(req).then(hit=> hit || fetch(req).then(r=>{ if(r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  e.respondWith(new Promise(resolve=>{
    let done = false;
    const finish = r=>{ if(!done && r){ done = true; resolve(r); } };
    const net = fetch(req).then(r=> save(req, r));
    // rete lenta (palestra sotto terra): dopo 3 s la copia salvata, se c'è; la rete intanto aggiorna la copia
    const t = setTimeout(()=> fromCache(req).then(finish, ()=>{}), 3000);
    // risposta d'errore (es. 500 o 404 mentre Netlify pubblica): meglio la copia salvata, se c'è
    net.then(r=>{ clearTimeout(t); if(r.ok) finish(r); else if(!done) fromCache(req).then(c=> finish(c || r), ()=> finish(r)); })
       .catch(()=>{ clearTimeout(t); fromCache(req).then(r=> finish(r || Response.error()), ()=> finish(Response.error())); });
  }));
});
