// Giardino — versione Netlify, gratuita. Sostituisce le funzioni di claude.ai che l'app usa (window.claude.use):
//   db    → /api/dati sul sito Netlify (codice di sincronizzazione casuale, salvato in questo browser e inviato
//           nell'intestazione x-giardino-code: mai nell'indirizzo, così non resta nei log)
//   meteo → Open-Meteo direttamente dal browser
//   Claude non è chiamato dall'app: ragiona nella chat di claude.ai attraverso il connettore Giardino (/mcp/<chiave>).
(function(){
'use strict';
const API='/api/dati';
const LS=k=>{ try{ return localStorage.getItem('giardino:net:'+k); }catch(e){ return null; } };
// true se scritto: se la memoria del telefono è piena le modifiche in attesa non si perdono in silenzio (lo dice l'app)
const LSset=(k,v)=>{ try{ if(v==null) localStorage.removeItem('giardino:net:'+k); else localStorage.setItem('giardino:net:'+k,v); return true; }catch(e){ return false; } };
const LSjson=k=>{ try{ return JSON.parse(LS(k)||'null'); }catch(e){ return null; } };
const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function nuovoCodice(){ const b=new Uint8Array(24); crypto.getRandomValues(b); const s=Array.from(b,x=>ALPHA[x&31]).join(''); return 'GRD-'+s.match(/.{6}/g).join('-'); }
let code=LS('code'); if(!/^[A-Z0-9-]{16,64}$/.test(code||'')){ code=nuovoCodice(); LSset('code',code); }
/* ---------------- senza rete ----------------
   offline: l'ultima richiesta al server non è arrivata per la rete (o navigator.onLine è falso). L'app lo mostra in alto
   con quante modifiche aspettano di partire (evento «giardino-rete»). Torna online alla prima richiesta riuscita. */
let offline=navigator.onLine===false;
const SENZA_RETE='Senza rete: riprova quando torna la connessione.';
// Senza rete e niente da inviare (che riprova da sé ogni 30 s): si richiede al server dopo 25 s, così l'indicatore non
// resta acceso fino al controllo dei 5 minuti dopo una sola richiesta andata a vuoto.
let riprova=null;
function segnaRete(off){
  off=!!off; const cambia=off!==offline; offline=off; avvisaRete();
  if(!off){ clearTimeout(riprova); riprova=null; return; }
  if(!riprova) riprova=setTimeout(()=>{ riprova=null; if(offline&&document.visibilityState==='visible') aggiorna(false).catch(()=>{}); },25000);
  return cambia;
}
function avvisaRete(){ try{ window.dispatchEvent(new CustomEvent('giardino-rete',{detail:{offline, inAttesa:contaInAttesa()}})); }catch(e){} }
const stato=(msg,err)=>{ const el=document.getElementById('netStatus'); if(el) el.textContent=msg; if(err&&typeof window.showNote==='function') window.showNote('err',msg); };
const VUOTO={location:null,plants:[],impostazioni:null,vacanza:null,eventi:[],piano_claude:null,meteo_manual:null,orti:[]};
// orto scelto nell'app (più orti in città diverse): il meteo e la pioggia misurata sono i suoi
const ortoId=()=>{ try{ return window.ortoAttivo?.()||'p'; }catch(e){ return 'p'; } };
function posizione(){ const g=docs.giardino; if(!g) return null; const id=ortoId(); return id==='p'?g.location||null:(g.orti||[]).find(o=>o&&o.id===id)?.location||null; }

/* ---------------- server ---------------- */
// Le risposte grandi arrivano compresse (gzip). Se una non arriva o non si legge riprova subito in chiaro; se la colpa è
// della compressione (risposta illeggibile, o due volte di fila) per una settimana le chiede in chiaro: un attimo senza
// rete non la spegne. Una risposta «ok» senza dati non vale mai: cancellerebbe quelli sul telefono.
async function api(method, body, op, keepalive, extra){
  try{ const j=await apiRete(method, body, op, keepalive, extra); segnaRete(false); return j; }
  catch(e){
    // rete assente o server che non risponde: un messaggio leggibile (non «Failed to fetch») e l'indicatore in alto
    if(e instanceof TypeError||e?.name==='AbortError'||e?.name==='TimeoutError'){ segnaRete(true); throw Object.assign(new Error(SENZA_RETE),{offline:true}); }
    segnaRete(false); throw e;
  }
}
// Una richiesta che il server accetta e non chiude più (rete debolissima, server bloccato) si interrompe: prima teneva
// ferme per sempre anche le modifiche dopo. 20 secondi; la foto da riconoscere (fino a 1,5 MB) ne ha 45.
async function apiRete(method, body, op, keepalive, extra){
  const prova=async chiaro=>{
    const ac=typeof AbortController==='function'?new AbortController():null, tm=ac&&setTimeout(()=>ac.abort(),op==='riconosci'?45000:(window.GIARDINO_ATTESA_RETE||20000));
    try{
      const r=await fetch(API+(op?'?op='+op:''),{method,headers:{'x-giardino-code':code,...(chiaro?{'x-giardino-gzip':'no'}:{}),...(body?{'content-type':'application/json'}:{}),...(extra||{})},body:body?JSON.stringify(body):undefined,cache:'no-store',keepalive:!!keepalive,signal:ac?.signal});
      const t=await r.text();   // interrotta (rete, o compressione che il browser non decodifica): errore di rete
      let j=null; try{ j=JSON.parse(t); }catch(e){}
      if(r.ok&&(j==null||typeof j!=='object')) throw Object.assign(new TypeError('risposta del server illeggibile'),{illeggibile:true});
      return [r,j];
    } finally { if(tm) clearTimeout(tm); }
  };
  const chiaro=Date.now()-(+LS('inChiaro')||0)<7*864e5;
  let r,j;
  try{ [r,j]=await prova(chiaro); if(!chiaro&&LS('gzipKo')) LSset('gzipKo',null); }
  catch(e){
    if(chiaro||!(e instanceof TypeError)||navigator.onLine===false) throw e;
    [r,j]=await prova(true);
    const ko=(+LS('gzipKo')||0)+1;
    if(e.illeggibile||ko>=2){ LSset('inChiaro',String(Date.now())); LSset('gzipKo',null); } else LSset('gzipKo',String(ko));
  }
  if(!r.ok) throw new Error(j?.error||('Errore del server ('+r.status+')'));
  return j;
}
let server=LSjson('cache'); // {rev, updatedAt, data}
LSset('meteo',null); LSset('storico',null);   // copie vecchie (una sola posizione): ora una per posizione
const docs={}, subs={};
const snap=n=>({id:n,exists:docs[n]!=null,data:()=>docs[n]??undefined,metadata:{fromCache:false,hasPendingWrites:false}});
const emit=n=>(subs[n]||[]).forEach(f=>{ try{ f(snap(n)); }catch(e){ console.error(e); } });
function dalServer(){
  const d={...VUOTO,...(server?.data||{})};
  const ev=Array.isArray(d.eventi)?d.eventi:[];
  docs.giardino={location:d.location,plants:d.plants||[],impostazioni:d.impostazioni||undefined,vacanza:d.vacanza,eventi_app:ev.filter(e=>e.fonte==='app'),orti:Array.isArray(d.orti)?d.orti:[],updatedAt:server?.updatedAt?new Date(server.updatedAt).toISOString():null};
  docs.meteo=d.meteo_manual||null;
  docs.piano=d.piano_claude||null;
  docs.eventi_bot={aggiornato:server?.updatedAt?new Date(server.updatedAt).toISOString():null,eventi:ev.filter(e=>e.fonte!=='app')};
  docs.piano_bot=null;
}
// pioggia misurata dalla stazione ARPAE (la scrive il bot nei dati, per ogni orto): nei giorni passati prende il posto di quella stimata
function misurataOra(){ const d=server?.data||{}, id=ortoId(); return (id==='p'?d.pioggia_misurata:d.pioggia_orti?.[id])||null; }
function conMisurata(m){
  const misurata=misurataOra();
  if(!m||!Array.isArray(m.days)||!misurata) return m;
  const oggi=new Intl.DateTimeFormat('en-CA',{timeZone:m.tz||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return {...m, days:conPioggiaMisurata(m.days,misurata,oggi), misurata:{stazione:misurata.stazione,km:misurata.km,giorni:misurata.giorni||{}}};
}
let primo=null;
// Scarica i dati solo se sono cambiati: l'app dice quale versione ha già (rev e ora del salvataggio) e, se è la stessa,
// il server risponde «invariato» con pochi byte. Restituisce true se sono arrivati dati nuovi.
const versione=()=>server&&server.rev?server.rev+'-'+server.updatedAt:'';
function scarica(){
  const v=versione(), revPrima=server?server.rev:null;
  return api('GET',null,null,false,v?{'x-giardino-versione':v}:null).then(j=>{
      const ora='Sincronizzato alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+'.';
      if(j&&j.invariato&&server){ if(!docs.giardino){ if(inAttesa) applicaLocale(inAttesa); dalServer(); } stato(ora); return false; }
      // mentre questa richiesta viaggiava è arrivata la risposta di un salvataggio, più recente: resta quella
      if(server&&server.rev!==revPrima&&j&&typeof j.rev==='number'&&j.rev<=server.rev){ stato(ora); return false; }
      // sopra i dati del server restano le modifiche fatte qui e non ancora arrivate (in attesa o in viaggio)
      server=j; for(const b of inInvio) applicaLocale(b); if(inAttesa) applicaLocale(inAttesa); LSset('cache',JSON.stringify(j)); dalServer(); stato(ora); return true; })
    .catch(e=>{ dalServer(); stato(e.offline?'Senza rete: uso i dati salvati su questo telefono.':'Server non raggiungibile ('+e.message+'): uso i dati salvati su questo telefono.'); return false; });
}
// dati del server con sopra le modifiche locali non ancora inviate
// piante cambiate pianta per pianta, come le unisce il server (unisciPiante in dati.mjs): le altre restano
function unisciPiante(prima,{set,del,ordine}={}){
  const via=new Set(del||[]), per=new Map((set||[]).filter(p=>p&&p.id).map(p=>[p.id,p]));
  let out=(prima||[]).filter(p=>p&&!via.has(p.id)).map(p=>per.get(p.id)||p);
  const ci=new Set(out.map(p=>p.id)); for(const p of per.values()) if(!ci.has(p.id)&&!via.has(p.id)) out.push(p);
  if(ordine?.length){ const pos=new Map(ordine.map((id,i)=>[id,i])); out=out.map((p,i)=>[p,pos.get(p.id)??1e6+i]).sort((a,b)=>a[1]-b[1]).map(x=>x[0]); }
  return out;
}
function applicaLocale(b){
  const d=server.data=server.data||{...VUOTO};
  for(const [k,v] of Object.entries(b.changes||{})) d[k]=v;
  if(b.piante) d.plants=unisciPiante(d.plants,b.piante);
  const via=new Set(b.remove||[]); d.eventi=(d.eventi||[]).filter(e=>!via.has(e.id));
  for(const e of b.add||[]) if(!d.eventi.some(x=>x.id===e.id)) d.eventi.push({...e,fonte:'app'});
}
const pronto=()=>primo||(primo=scarica().then(r=>{
  if(!conCopia) applicato=server?.rev??null;
  if(inAttesa){ clearTimeout(attesaT); attesaT=setTimeout(svuota,1000); }
  // l'app era già aperta con la copia del telefono: se il server ha qualcosa di nuovo lo porta sullo schermo adesso
  if(conCopia&&r) dopoScarica(true,false).catch(()=>{});
  return r; }));
// Apertura senza aspettare il server: se sul telefono c'è la copia dell'ultima volta, l'app parte subito da quella
// (con sopra le modifiche non ancora inviate) e intanto chiede al server se è cambiato qualcosa. Prima le piante
// comparivano solo dopo la risposta del server (e del meteo): con rete lenta, uno o due secondi di «Caricamento…».
const primaLettura=()=>{ const p=pronto(); return conCopia?Promise.resolve(false):p; };
// Porta sullo schermo i dati del server (anche le modifiche di Claude, Telegram o di un altro telefono arrivate insieme
// alla risposta di un salvataggio), ma solo se nel frattempo non hai cambiato niente: altrimenti alla prossima risposta.
// base = i dati così come li ha in mano l'app (quelli dell'apertura, dell'ultimo allineamento o del suo ultimo salvataggio).
// Le modifiche si calcolano rispetto a questi, non rispetto all'ultima risposta del server: se nel frattempo Claude o
// Telegram hanno cambiato una pianta e tu segni un'innaffiatura prima che lo schermo si aggiorni, parte solo
// l'innaffiatura (prima la pianta tornava com'era sul telefono).
let applicato=null, base=null;
function allinea(){
  if(!server || server.rev===applicato || inAttesa || window.scrittureInSospeso?.() || typeof window.applyMain!=='function') return;
  applicato=server.rev; base=docs.giardino; window.applyMain(docs.giardino); window.renderAll?.();
}

/* Le modifiche partono come differenze: campi cambiati ed eventi aggiunti/tolti. Il server le unisce a quelle di Claude e Telegram. */
// le modifiche non ancora salvate restano anche sul telefono: se l'app si chiude offline, partono alla prossima apertura
let coda=Promise.resolve(), inAttesa=LSjson('pending'), attesaT=null, inInvio=[];   // inInvio: modifiche già partite, risposta non ancora arrivata
let conCopia=false;
if(server&&server.data&&typeof server.data==='object'){ try{ if(inAttesa) applicaLocale(inAttesa); dalServer(); applicato=server.rev??null; conCopia=true; }catch(e){ conCopia=false; } }
// Due gruppi di modifiche in attesa diventano uno. Un evento aggiunto e poi tolto prima di partire (💧 e subito Annulla,
// senza rete) non parte più: prima il server toglieva prima e aggiungeva dopo, e l'innaffiatura annullata ricompariva.
// Il «togli» resta (se nel frattempo era arrivato, il server lo toglie; altrimenti non fa niente).
function unisci(a,b){
  if(!a) return pulisci(b);
  const pa=a.piante, pb=b.piante;
  let piante=pa||pb||null;
  if(pa&&pb){ const per=new Map([...(pa.set||[]),...(pb.set||[])].map(p=>[p.id,p])), del=[...new Set([...(pa.del||[]),...(pb.del||[])])];
    for(const id of del) per.delete(id); piante={set:[...per.values()], del, ordine:pb.ordine||pa.ordine}; }
  const out={changes:{...a.changes,...b.changes},add:[...a.add,...b.add],remove:[...a.remove,...b.remove]};
  // un elenco intero (app vecchia o pending vecchio) dopo modifiche pianta per pianta: vale l'elenco più recente
  if(b.changes&&'plants' in b.changes) piante=null; else if(piante&&out.changes&&'plants' in out.changes){ out.changes.plants=unisciPiante(out.changes.plants,piante); piante=null; }
  if(piante) out.piante=piante;
  return pulisci(out);
}
function pulisci(x){ if(!x) return x; const via=new Set(x.remove||[]); return {...x, add:(x.add||[]).filter(e=>!via.has(e.id))}; }
function contaInAttesa(){ let n=0; for(const b of [...inInvio, inAttesa]) if(b){ n+=Object.keys(b.changes||{}).length+(b.add||[]).length+(b.remove||[]).length+(b.piante?(b.piante.set||[]).length+(b.piante.del||[]).length:0); } return n; }
function invia(diff){
  inAttesa=unisci(inAttesa,diff);
  if(!LSset('pending',JSON.stringify(inAttesa))) stato('Memoria del telefono piena: le ultime modifiche non sono salvate sul telefono. Restano finché l\'app è aperta: riapri la rete prima di chiuderla.',true);
  avvisaRete();
  clearTimeout(attesaT); attesaT=setTimeout(svuota,600);
}
function svuota(keepalive){
  const body=inAttesa; inAttesa=null; if(!body) return coda;
  inInvio.push(body); const arrivata=()=>{ inInvio=inInvio.filter(b=>b!==body); };
  coda=coda.then(()=>api('POST',body,null,keepalive)).then(j=>{ arrivata(); avvisaRete(); window.nascondiNota?.('Non salvato'); server=j; LSset('cache',JSON.stringify(j)); if(!inAttesa) LSset('pending',null); dalServer(); emit('eventi_bot'); emit('piano'); allinea(); stato('Salvato alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+': Claude e Telegram vedono già le modifiche.'); })
    .catch(e=>{ arrivata(); inAttesa=unisci(body,inAttesa||{changes:{},add:[],remove:[]}); LSset('pending',JSON.stringify(inAttesa)); avvisaRete();
      // senza rete (anche quando il telefono crede di averla) non è un errore: le modifiche aspettano sul telefono
      if(e.offline||navigator.onLine===false) stato('Sei offline: le modifiche restano sul telefono e partono appena torna la rete.');
      else stato('Non salvato sul server ('+e.message+'): riprovo tra poco.', true);
      clearTimeout(attesaT); attesaT=setTimeout(svuota,30000); });
  return coda;
}
function diffGiardino(nuovo){
  const prima=base||docs.giardino||{}, changes={};
  for(const f of ['location','impostazioni','vacanza','orti']) if(JSON.stringify(nuovo[f]??null)!==JSON.stringify(prima[f]??null)) changes[f]=nuovo[f]??null;
  // piante: solo quelle aggiunte, cambiate o tolte, e l'ordine (prima l'intero elenco, che cancellava quelle aggiunte
  // da Claude o da un altro telefono mentre questo era senza rete)
  let piante=null;
  const pp=new Map((prima.plants||[]).map(p=>[p.id,JSON.stringify(p)])), np=nuovo.plants||[];
  const set=np.filter(p=>pp.get(p.id)!==JSON.stringify(p)), del=[...pp.keys()].filter(id=>!np.some(p=>p.id===id));
  const ordine=np.map(p=>p.id), ordineCambiato=ordine.join('|')!==(prima.plants||[]).map(p=>p.id).join('|');
  if(set.length||del.length||ordineCambiato) piante={set,del,ordine};
  const pr=new Map((prima.eventi_app||[]).map(e=>[e.id,e])), nu=new Map((nuovo.eventi_app||[]).map(e=>[e.id,e]));
  const d={changes, add:[...nu.values()].filter(e=>!pr.has(e.id)), remove:[...pr.keys()].filter(id=>!nu.has(id))};
  if(piante) d.piante=piante;
  return d;
}

/* ---------------- meteo ---------------- */
// stesse richieste e stessi calcoli del bot (urlMeteo, componiMeteo nel modello), in parallelo: previsioni di base,
// più modelli insieme (ensemble) e storico dei giorni passati
async function meteo(lat,lon){
  const u=urlMeteo(lat,lon);
  const [r,rMod,st]=await Promise.all([fetch(u.base),fetch(u.modelli).catch(()=>null),storico(lat,lon,isoDate(new Date())).catch(()=>null)]); if(!r.ok) throw new Error('Open-Meteo '+r.status);
  const j=await r.json(), jMod=rMod&&rMod.ok?await rMod.json().catch(()=>null):null;
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:j.timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  const oggi=p.year+'-'+p.month+'-'+p.day;
  return {source:'open-meteo',updatedAt:new Date().toISOString(),lat,lon,...componiMeteo(j,null,oggi,+p.hour,jMod),storico:st?.temp||null,archivio:st?.arch||null};
}
// storico dei 400 giorni passati (temperature per le fasi; pioggia, evaporazione e sole per il bilancio dell'acqua):
// scaricato una volta al giorno. {temp, arch}
// una copia per posizione (con più orti si passa dall'uno all'altro senza riscaricare)
const kPos=(n,lat,lon)=>n+'@'+(+lat).toFixed(2)+','+(+lon).toFixed(2);
async function storico(lat,lon,oggi){
  const c=storicoMem&&storicoMem.lat===lat&&storicoMem.lon===lon ? storicoMem : (storicoMem=LSjson(kPos('storico',lat,lon))), qui=c&&c.lat===lat&&c.lon===lon&&c.temp&&c.arch;
  if(qui&&c.giorno===oggi) return c;
  const scarica=fetch(urlStorico(lat,lon,oggi)).then(r=>r.ok?r.json():null).then(j=>{ const temp=j?storicoDa(j):{}, arch=j?archivioDa(j):{};
    if(Object.keys(temp).length){ const x={giorno:oggi,lat,lon,temp,arch}; storicoMem=x; LSset(kPos('storico',lat,lon),JSON.stringify(x)); return x; } return null; }).catch(()=>null);
  // c'è già quello di ieri: si usa subito e il nuovo arriva per la prossima volta (l'avvio non aspetta)
  if(qui) return c;
  return (await scarica)||null;
}
// storico e archivio (~25 KB) stanno una volta sola nella memoria del telefono, in 'storico': il meteo salvato non li ripete
let storicoMem=null;
const senzaStorico = m => { if(!m) return m; const {storico, archivio, ...r}=m; return r; };
function conStorico(m){
  if(!m) return m;
  const s=storicoMem&&storicoMem.lat===m.lat&&storicoMem.lon===m.lon ? storicoMem : (storicoMem=LSjson(kPos('storico',m.lat,m.lon)));
  return s&&s.lat===m.lat&&s.lon===m.lon&&s.temp ? {...m, storico:s.temp, archivio:s.arch||null} : m;
}
// Il meteo salvato vale un'ora. Se è più vecchio ma ha ancora le previsioni di oggi (la prima apertura del mattino, o
// dopo qualche ora) l'app lo mostra subito e intanto scarica quello nuovo: prima il piano aspettava Open-Meteo.
let meteoInCorso=null;
function caricaMeteo(forza){
  const loc=posizione(); if(!loc) return Promise.resolve();
  const km=kPos('meteo',loc.lat,loc.lon), c=conStorico(LSjson(km)), mio=!!(c&&c.lat===loc.lat&&c.lon===loc.lon);
  // previsioni valide un'ora e solo nello stesso giorno: il polling ogni 5 minuti non le riscarica
  if(!forza&&mio&&Date.now()-Date.parse(c.updatedAt)<3600e3&&new Date(c.updatedAt).toDateString()===new Date().toDateString()){ const nuovo=docs.meteo_bot!==c&&docs.meteo_bot?.updatedAt!==c.updatedAt; docs.meteo_bot=conMisurata(c); return Promise.resolve(nuovo); }
  if(!forza&&mio&&docs.meteo_bot?.updatedAt!==c.updatedAt&&Array.isArray(c.days)&&c.days.some(d=>d&&d.date===isoDate(new Date()))){ docs.meteo_bot=conMisurata(c); emit('meteo_bot'); }
  if(meteoInCorso&&meteoInCorso.k===km) return meteoInCorso.p;
  // un cambio di orto o di posizione arrivato nel frattempo: il meteo di prima non deve prendere il posto di quello nuovo
  const qui=()=>{ const l=posizione(); return !!(l&&l.lat===loc.lat&&l.lon===loc.lon); };
  const p=(async()=>{
    try{ const m=await meteo(loc.lat,loc.lon); LSset(km,JSON.stringify(senzaStorico(m))); if(qui()) docs.meteo_bot=conMisurata(m); return true; }catch(e){}
    // Open-Meteo non risponde dal telefono: il meteo dal server (Open-Meteo dal server, o la riserva MET Norway)
    try{ const m=await api('GET',null,'meteo&orto='+encodeURIComponent(ortoId()));
      if(m&&Array.isArray(m.days)&&m.days.length&&qui()){ const x={...m,source:'open-meteo',fonte:m.fonte||'server',updatedAt:new Date().toISOString(),lat:loc.lat,lon:loc.lon};
        // storico dal server (Open-Meteo non risponde dal telefono): lo si tiene per il bilancio dell'acqua e le fasi
        if(x.storico&&x.archivio&&!(storicoMem&&storicoMem.lat===loc.lat&&storicoMem.lon===loc.lon&&storicoMem.arch)){ storicoMem={giorno:isoDate(new Date()),lat:loc.lat,lon:loc.lon,temp:x.storico,arch:x.archivio}; LSset(kPos('storico',loc.lat,loc.lon),JSON.stringify(storicoMem)); }
        LSset(km,JSON.stringify(senzaStorico(x))); docs.meteo_bot=conMisurata(x); return true; } }catch(e){}
    if(!qui()) return false;
    const nuovo=docs.meteo_bot?.updatedAt!==c?.updatedAt; docs.meteo_bot=conMisurata(c); stato('Meteo non disponibile: uso gli ultimi dati salvati.'); return nuovo;
  })();
  meteoInCorso={k:km,p}; p.then(()=>{ if(meteoInCorso&&meteoInCorso.p===p) meteoInCorso=null; });
  return p;
}

/* ---------------- documenti come li chiede l'app ---------------- */
function doc(path){
  const n=String(path).split('/').pop();
  const carica=()=>n==='meteo_bot'?primaLettura().then(()=>caricaMeteo(false)):primaLettura();
  return {
    id:n, path,
    get: async()=>{ await carica(); if(n==='giardino') base=docs.giardino; return snap(n); },
    set: async data=>{
      if(n==='giardino'){
        const prima=posizione(), d=diffGiardino(data);
        docs.giardino=base={...data};
        if(Object.keys(d.changes).length||d.add.length||d.remove.length||d.piante) invia(d);
        const l=posizione(); if(l&&(!prima||prima.lat!==l.lat||prima.lon!==l.lon)) caricaMeteo(true).then(()=>emit('meteo_bot'));
      } else if(n==='meteo'){ docs.meteo=data&&data.days?data:null; invia({changes:{meteo_manual:docs.meteo},add:[],remove:[]}); }
      else if(n==='piano'){ docs.piano=data&&data.data?data:null; invia({changes:{piano_claude:docs.piano},add:[],remove:[]}); }
    },
    onSnapshot:fn=>{ (subs[n]=subs[n]||[]).push(fn); carica().then(()=>fn(snap(n))); return ()=>{ subs[n]=subs[n].filter(f=>f!==fn); }; }
  };
}

/* ---------------- API per l'app ---------------- */
async function aggiorna(forza){
  await window.salvaSubito?.();          // prima partono le modifiche fatte nell'app da meno di mezzo secondo
  if(inAttesa) await svuota(); else await coda;
  await dopoScarica(await scarica(), forza);
}
// dopo aver chiesto i dati al server: meteo (della posizione di adesso) e schermo, solo se è arrivato qualcosa di nuovo
async function dopoScarica(dati, forza){
  const met=await caricaMeteo(!!forza);
  // l'app ridisegna solo se è arrivato qualcosa di nuovo (prima: 3 volte a ogni controllo, anche senza novità)
  const lp=posizione();
  if(dati&&!met&&docs.meteo_bot){ const prima=JSON.stringify(docs.meteo_bot.misurata||null); docs.meteo_bot=conMisurata((lp&&conStorico(LSjson(kPos('meteo',lp.lat,lp.lon))))||docs.meteo_bot); if(JSON.stringify(docs.meteo_bot.misurata||null)!==prima) emit('meteo_bot'); }
  if(met||forza) emit('meteo_bot');
  if(dati||forza){ emit('eventi_bot'); emit('piano'); }
  allinea();
}
window.GiardinoNet={
  rete:()=>({offline, inAttesa:contaInAttesa()}),
  codice:()=>code,
  usaCodice(c){ c=String(c||'').trim().toUpperCase(); if(!/^[A-Z0-9-]{16,64}$/.test(c)) return false; LSset('code',c); LSset('cache',null); location.reload(); return true; },
  mcp:(action,extra)=>action?api('POST',{action,...(extra||{})},'mcp'):api('GET',null,'mcp'),
  crediti:(rimasti)=>rimasti==null?api('GET',null,'crediti'):api('POST',{rimasti},'crediti'),
  stato:()=>api('GET',null,'stato'),
  pioggia:()=>api('GET',null,'pioggia&orto='+encodeURIComponent(ortoId())),
  // cambio di orto nell'app: il meteo di quell'orto (dalla copia sul telefono se c'è, poi aggiornato)
  cambiaOrto:()=>{ docs.meteo_bot=null; emit('meteo_bot'); return pronto().then(()=>caricaMeteo(false)).then(()=>emit('meteo_bot')).catch(()=>{}); },
  riconosci:immagine=>api('POST',{immagine},'riconosci'),
  telegram:(action,extra)=>action?api('POST',{action,...(extra||{})},'telegram'):api('GET',null,'telegram'),
  aggiorna,
  async geocodifica(q){
    const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:q,count:'1',language:'it',format:'json'}));
    const x=(await r.json()).results?.[0]; if(!x) return null;
    return {name:x.name,detail:[x.admin1,x.country].filter(Boolean).join(', '),lat:+x.latitude.toFixed(4),lon:+x.longitude.toFixed(4),alt:x.elevation??null,clima:''};
  }
};
// aggiorna da solo quando torni sull'app e ogni 5 minuti mentre è aperta e visibile (risposte di Telegram, modifiche di Claude)
// app in background o chiusa: le modifiche in attesa partono subito, con keepalive (l'invio continua anche a pagina chiusa);
// se non arrivano restano salvate sul telefono e ripartono alla prossima apertura
function salvaPrimaDiUscire(){ Promise.resolve(window.salvaSubito?.()).then(()=>{ if(inAttesa&&navigator.onLine!==false) svuota(true); }).catch(()=>{}); }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') salvaPrimaDiUscire(); else aggiorna(false).catch(()=>{}); });
setInterval(()=>{ if(document.visibilityState==='visible') aggiorna(false).catch(()=>{}); },300000);
// torna la rete: partono le modifiche in attesa e arrivano le novità (prima solo le modifiche: le novità al prossimo controllo)
window.addEventListener('online',()=>{ aggiorna(false).catch(()=>{}); });
window.addEventListener('offline',()=>segnaRete(true));
window.addEventListener('pagehide',salvaPrimaDiUscire);
// versione nuova: il service worker apre subito la copia salvata e intanto scarica quella del sito; se è cambiata lo dice qui.
// Appena aperta (meno di 3 secondi, niente tocchi) l'app si ricarica subito; altrimenti la prossima volta che ci torni,
// se non hai una finestra aperta o un campo in scrittura. Al massimo una volta al minuto (niente ricariche a catena).
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  const avvio=Date.now(); let toccata=false, nuova=false;
  for(const t of ['pointerdown','keydown']) addEventListener(t,()=>{ toccata=true; },{capture:true,passive:true});
  const libera=()=>![...document.querySelectorAll('.sheet')].some(x=>!x.hidden) && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'');
  const ricarica=()=>{
    let prima=0; try{ prima=+sessionStorage.getItem('ricaricata')||0; }catch{}
    if(Date.now()-prima<60000) return;
    try{ sessionStorage.setItem('ricaricata',String(Date.now())); }catch{}
    nuova=false; Promise.resolve(window.salvaSubito?.()).catch(()=>{}).then(()=>location.reload());
  };
  navigator.serviceWorker.addEventListener('message',e=>{ if(e.data?.tipo!=='nuova-versione') return; nuova=true; if(!toccata&&Date.now()-avvio<3000&&libera()) ricarica(); });
  document.addEventListener('visibilitychange',()=>{ if(nuova&&document.visibilityState==='visible'&&libera()) ricarica(); });
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

const caps={ db:{doc, collection:()=>{ throw new Error('non disponibile'); }}, user:{ id:async()=>'locale', me:async()=>({id:'locale',name:''}) }, mcp:{} };
window.claude={ use:async n=>caps[n]??null };
})();
