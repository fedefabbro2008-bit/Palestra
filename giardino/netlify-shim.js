// Giardino — versione Netlify, gratuita. Sostituisce le funzioni di claude.ai che l'app usa (window.claude.use):
//   db    → /api/dati sul sito Netlify (codice di sincronizzazione casuale, salvato in questo browser e inviato
//           nell'intestazione x-giardino-code: mai nell'indirizzo, così non resta nei log)
//   meteo → Open-Meteo direttamente dal browser
//   Claude non è chiamato dall'app: ragiona nella chat di claude.ai attraverso il connettore Giardino (/mcp/<chiave>).
(function(){
'use strict';
const API='/api/dati';
const LS=k=>{ try{ return localStorage.getItem('giardino:net:'+k); }catch(e){ return null; } };
const LSset=(k,v)=>{ try{ if(v==null) localStorage.removeItem('giardino:net:'+k); else localStorage.setItem('giardino:net:'+k,v); }catch(e){} };
const LSjson=k=>{ try{ return JSON.parse(LS(k)||'null'); }catch(e){ return null; } };
const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function nuovoCodice(){ const b=new Uint8Array(24); crypto.getRandomValues(b); const s=Array.from(b,x=>ALPHA[x&31]).join(''); return 'GRD-'+s.match(/.{6}/g).join('-'); }
let code=LS('code'); if(!/^[A-Z0-9-]{16,64}$/.test(code||'')){ code=nuovoCodice(); LSset('code',code); }
const stato=(msg,err)=>{ const el=document.getElementById('netStatus'); if(el) el.textContent=msg; if(err&&typeof window.showNote==='function') window.showNote('err',msg); };
const VUOTO={location:null,plants:[],impostazioni:null,vacanza:null,eventi:[],piano_claude:null,meteo_manual:null};

/* ---------------- server ---------------- */
// Le risposte grandi arrivano compresse (gzip). Se una non arriva o non si legge riprova subito in chiaro; se la colpa è
// della compressione (risposta illeggibile, o due volte di fila) per una settimana le chiede in chiaro: un attimo senza
// rete non la spegne. Una risposta «ok» senza dati non vale mai: cancellerebbe quelli sul telefono.
async function api(method, body, op, keepalive, extra){
  const prova=async chiaro=>{
    const r=await fetch(API+(op?'?op='+op:''),{method,headers:{'x-giardino-code':code,...(chiaro?{'x-giardino-gzip':'no'}:{}),...(body?{'content-type':'application/json'}:{}),...(extra||{})},body:body?JSON.stringify(body):undefined,cache:'no-store',keepalive:!!keepalive});
    const t=await r.text();   // interrotta (rete, o compressione che il browser non decodifica): errore di rete
    let j=null; try{ j=JSON.parse(t); }catch(e){}
    if(r.ok&&(j==null||typeof j!=='object')) throw Object.assign(new TypeError('risposta del server illeggibile'),{illeggibile:true});
    return [r,j];
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
const docs={}, subs={};
const snap=n=>({id:n,exists:docs[n]!=null,data:()=>docs[n]??undefined,metadata:{fromCache:false,hasPendingWrites:false}});
const emit=n=>(subs[n]||[]).forEach(f=>{ try{ f(snap(n)); }catch(e){ console.error(e); } });
function dalServer(){
  const d={...VUOTO,...(server?.data||{})};
  const ev=Array.isArray(d.eventi)?d.eventi:[];
  docs.giardino={location:d.location,plants:d.plants||[],impostazioni:d.impostazioni||undefined,vacanza:d.vacanza,eventi_app:ev.filter(e=>e.fonte==='app'),updatedAt:server?.updatedAt?new Date(server.updatedAt).toISOString():null};
  docs.meteo=d.meteo_manual||null;
  docs.piano=d.piano_claude||null;
  docs.eventi_bot={aggiornato:server?.updatedAt?new Date(server.updatedAt).toISOString():null,eventi:ev.filter(e=>e.fonte!=='app')};
  docs.piano_bot=null;
  misurata=d.pioggia_misurata||null;
}
// pioggia misurata dalla stazione ARPAE (la scrive il bot nei dati): nei giorni passati prende il posto di quella stimata
let misurata=null;
function conMisurata(m){
  if(!m||!Array.isArray(m.days)||!misurata) return m;
  const oggi=new Intl.DateTimeFormat('en-CA',{timeZone:m.tz||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return {...m, days:conPioggiaMisurata(m.days,misurata,oggi), misurata:{stazione:misurata.stazione,km:misurata.km,giorni:misurata.giorni||{}}};
}
let primo=null;
// Scarica i dati solo se sono cambiati: l'app dice quale versione ha già (rev e ora del salvataggio) e, se è la stessa,
// il server risponde «invariato» con pochi byte. Restituisce true se sono arrivati dati nuovi.
const versione=()=>server&&server.rev?server.rev+'-'+server.updatedAt:'';
function scarica(){
  const v=versione();
  return api('GET',null,null,false,v?{'x-giardino-versione':v}:null).then(j=>{
      const ora='Sincronizzato alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+'.';
      if(j&&j.invariato&&server){ if(!docs.giardino){ if(inAttesa) applicaLocale(inAttesa); dalServer(); } stato(ora); return false; }
      server=j; if(inAttesa) applicaLocale(inAttesa); LSset('cache',JSON.stringify(j)); dalServer(); stato(ora); return true; })
    .catch(e=>{ dalServer(); stato('Server non raggiungibile ('+e.message+'): uso i dati salvati su questo dispositivo.'); return false; });
}
// dati del server con sopra le modifiche locali non ancora inviate
function applicaLocale(b){
  const d=server.data=server.data||{...VUOTO};
  for(const [k,v] of Object.entries(b.changes||{})) d[k]=v;
  const via=new Set(b.remove||[]); d.eventi=(d.eventi||[]).filter(e=>!via.has(e.id));
  for(const e of b.add||[]) if(!d.eventi.some(x=>x.id===e.id)) d.eventi.push({...e,fonte:'app'});
}
const pronto=()=>primo||(primo=scarica().then(r=>{ applicato=server?.rev??null; if(inAttesa){ clearTimeout(attesaT); attesaT=setTimeout(svuota,1000); } return r; }));
// Porta sullo schermo i dati del server (anche le modifiche di Claude, Telegram o di un altro telefono arrivate insieme
// alla risposta di un salvataggio), ma solo se nel frattempo non hai cambiato niente: altrimenti alla prossima risposta.
let applicato=null;
function allinea(){
  if(!server || server.rev===applicato || inAttesa || window.scrittureInSospeso?.() || typeof window.applyMain!=='function') return;
  applicato=server.rev; window.applyMain(docs.giardino); window.renderAll?.();
}

/* Le modifiche partono come differenze: campi cambiati ed eventi aggiunti/tolti. Il server le unisce a quelle di Claude e Telegram. */
// le modifiche non ancora salvate restano anche sul telefono: se l'app si chiude offline, partono alla prossima apertura
let coda=Promise.resolve(), inAttesa=LSjson('pending'), attesaT=null;
const unisci=(a,b)=>a?{changes:{...a.changes,...b.changes},add:[...a.add,...b.add],remove:[...a.remove,...b.remove]}:b;
function invia(diff){
  inAttesa=unisci(inAttesa,diff); LSset('pending',JSON.stringify(inAttesa));
  clearTimeout(attesaT); attesaT=setTimeout(svuota,600);
}
function svuota(keepalive){
  const body=inAttesa; inAttesa=null; if(!body) return coda;
  coda=coda.then(()=>api('POST',body,null,keepalive)).then(j=>{ server=j; LSset('cache',JSON.stringify(j)); if(!inAttesa) LSset('pending',null); dalServer(); emit('eventi_bot'); emit('piano'); allinea(); stato('Salvato alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+': Claude e Telegram vedono già le modifiche.'); })
    .catch(e=>{ inAttesa=unisci(body,inAttesa||{changes:{},add:[],remove:[]}); LSset('pending',JSON.stringify(inAttesa));
      stato(navigator.onLine===false?'Sei offline: le modifiche restano sul telefono e partono appena torna la rete.':'Non salvato sul server ('+e.message+'): riprovo tra poco.', navigator.onLine!==false);
      clearTimeout(attesaT); attesaT=setTimeout(svuota,30000); });
  return coda;
}
function diffGiardino(nuovo){
  const prima=docs.giardino||{}, changes={};
  for(const f of ['location','plants','impostazioni','vacanza']) if(JSON.stringify(nuovo[f]??null)!==JSON.stringify(prima[f]??null)) changes[f]=nuovo[f]??null;
  const pr=new Map((prima.eventi_app||[]).map(e=>[e.id,e])), nu=new Map((nuovo.eventi_app||[]).map(e=>[e.id,e]));
  return {changes, add:[...nu.values()].filter(e=>!pr.has(e.id)), remove:[...pr.keys()].filter(id=>!nu.has(id))};
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
async function storico(lat,lon,oggi){
  const c=storicoMem&&storicoMem.lat===lat&&storicoMem.lon===lon ? storicoMem : (storicoMem=LSjson('storico')), qui=c&&c.lat===lat&&c.lon===lon&&c.temp&&c.arch;
  if(qui&&c.giorno===oggi) return c;
  const scarica=fetch(urlStorico(lat,lon,oggi)).then(r=>r.ok?r.json():null).then(j=>{ const temp=j?storicoDa(j):{}, arch=j?archivioDa(j):{};
    if(Object.keys(temp).length){ const x={giorno:oggi,lat,lon,temp,arch}; storicoMem=x; LSset('storico',JSON.stringify(x)); return x; } return null; }).catch(()=>null);
  // c'è già quello di ieri: si usa subito e il nuovo arriva per la prossima volta (l'avvio non aspetta)
  if(qui) return c;
  return (await scarica)||null;
}
// storico e archivio (~25 KB) stanno una volta sola nella memoria del telefono, in 'storico': il meteo salvato non li ripete
let storicoMem=null;
const senzaStorico = m => { if(!m) return m; const {storico, archivio, ...r}=m; return r; };
function conStorico(m){
  if(!m) return m;
  const s=storicoMem&&storicoMem.lat===m.lat&&storicoMem.lon===m.lon ? storicoMem : (storicoMem=LSjson('storico'));
  return s&&s.lat===m.lat&&s.lon===m.lon&&s.temp ? {...m, storico:s.temp, archivio:s.arch||null} : m;
}
async function caricaMeteo(forza){
  const loc=docs.giardino?.location; if(!loc) return;
  const c=conStorico(LSjson('meteo'));
  // previsioni valide un'ora e solo nello stesso giorno: il polling ogni 2 minuti non le riscarica
  if(!forza&&c&&c.lat===loc.lat&&c.lon===loc.lon&&Date.now()-Date.parse(c.updatedAt)<3600e3&&new Date(c.updatedAt).toDateString()===new Date().toDateString()){ const nuovo=docs.meteo_bot!==c&&docs.meteo_bot?.updatedAt!==c.updatedAt; docs.meteo_bot=conMisurata(c); return nuovo; }
  try{ const m=await meteo(loc.lat,loc.lon); LSset('meteo',JSON.stringify(senzaStorico(m))); docs.meteo_bot=conMisurata(m); return true; }catch(e){}
  // Open-Meteo non risponde dal telefono: il meteo dal server (Open-Meteo dal server, o la riserva MET Norway)
  try{ const m=await api('GET',null,'meteo');
    if(m&&Array.isArray(m.days)&&m.days.length){ const x={...m,source:'open-meteo',fonte:m.fonte||'server',updatedAt:new Date().toISOString(),lat:loc.lat,lon:loc.lon};
      // storico dal server (Open-Meteo non risponde dal telefono): lo si tiene per il bilancio dell'acqua e le fasi
      if(x.storico&&x.archivio&&!(storicoMem&&storicoMem.lat===loc.lat&&storicoMem.lon===loc.lon&&storicoMem.arch)){ storicoMem={giorno:isoDate(new Date()),lat:loc.lat,lon:loc.lon,temp:x.storico,arch:x.archivio}; LSset('storico',JSON.stringify(storicoMem)); }
      LSset('meteo',JSON.stringify(senzaStorico(x))); docs.meteo_bot=conMisurata(x); return true; } }catch(e){}
  const nuovo=docs.meteo_bot?.updatedAt!==c?.updatedAt; docs.meteo_bot=conMisurata(c); stato('Meteo non disponibile: uso gli ultimi dati salvati.'); return nuovo;
}

/* ---------------- documenti come li chiede l'app ---------------- */
function doc(path){
  const n=String(path).split('/').pop();
  const carica=()=>n==='meteo_bot'?pronto().then(()=>caricaMeteo(false)):pronto();
  return {
    id:n, path,
    get: async()=>{ await carica(); return snap(n); },
    set: async data=>{
      if(n==='giardino'){
        const prima=docs.giardino?.location, d=diffGiardino(data);
        docs.giardino={...data};
        if(Object.keys(d.changes).length||d.add.length||d.remove.length) invia(d);
        const l=data.location; if(l&&(!prima||prima.lat!==l.lat||prima.lon!==l.lon)) caricaMeteo(true).then(()=>emit('meteo_bot'));
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
  const dati=await scarica(), met=await caricaMeteo(!!forza);
  // l'app ridisegna solo se è arrivato qualcosa di nuovo (prima: 3 volte a ogni controllo, anche senza novità)
  if(dati&&!met&&docs.meteo_bot){ const prima=JSON.stringify(docs.meteo_bot.misurata||null); docs.meteo_bot=conMisurata(conStorico(LSjson('meteo'))||docs.meteo_bot); if(JSON.stringify(docs.meteo_bot.misurata||null)!==prima) emit('meteo_bot'); }
  if(met||forza) emit('meteo_bot');
  if(dati||forza){ emit('eventi_bot'); emit('piano'); }
  allinea();
}
window.GiardinoNet={
  codice:()=>code,
  usaCodice(c){ c=String(c||'').trim().toUpperCase(); if(!/^[A-Z0-9-]{16,64}$/.test(c)) return false; LSset('code',c); LSset('cache',null); location.reload(); return true; },
  mcp:(action,extra)=>action?api('POST',{action,...(extra||{})},'mcp'):api('GET',null,'mcp'),
  crediti:(rimasti)=>rimasti==null?api('GET',null,'crediti'):api('POST',{rimasti},'crediti'),
  stato:()=>api('GET',null,'stato'),
  pioggia:()=>api('GET',null,'pioggia'),
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
window.addEventListener('online',()=>{ if(inAttesa) svuota(); });
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
