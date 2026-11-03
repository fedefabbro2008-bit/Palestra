// Giardino — versione Netlify, gratuita. Sostituisce le funzioni di claude.ai che l'app usa (window.claude.use):
//   db    → /api/dati sul sito Netlify (codice di sincronizzazione casuale, salvato in questo browser)
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
async function api(method, body, op){
  const r=await fetch(API+'?code='+encodeURIComponent(code)+(op?'&op='+op:''),{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const j=await r.json().catch(()=>null);
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
}
let primo=null;
function scarica(){
  return api('GET').then(j=>{ server=j; if(inAttesa) applicaLocale(inAttesa); LSset('cache',JSON.stringify(j)); dalServer(); stato('Sincronizzato alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+'.'); return true; })
    .catch(e=>{ dalServer(); stato('Server non raggiungibile ('+e.message+'): uso i dati salvati su questo dispositivo.'); return false; });
}
// dati del server con sopra le modifiche locali non ancora inviate
function applicaLocale(b){
  const d=server.data=server.data||{...VUOTO};
  for(const [k,v] of Object.entries(b.changes||{})) d[k]=v;
  const via=new Set(b.remove||[]); d.eventi=(d.eventi||[]).filter(e=>!via.has(e.id));
  for(const e of b.add||[]) if(!d.eventi.some(x=>x.id===e.id)) d.eventi.push({...e,fonte:'app'});
}
const pronto=()=>primo||(primo=scarica().then(r=>{ if(inAttesa){ clearTimeout(attesaT); attesaT=setTimeout(svuota,1000); } return r; }));

/* Le modifiche partono come differenze: campi cambiati ed eventi aggiunti/tolti. Il server le unisce a quelle di Claude e Telegram. */
// le modifiche non ancora salvate restano anche sul telefono: se l'app si chiude offline, partono alla prossima apertura
let coda=Promise.resolve(), inAttesa=LSjson('pending'), attesaT=null;
const unisci=(a,b)=>a?{changes:{...a.changes,...b.changes},add:[...a.add,...b.add],remove:[...a.remove,...b.remove]}:b;
function invia(diff){
  inAttesa=unisci(inAttesa,diff); LSset('pending',JSON.stringify(inAttesa));
  clearTimeout(attesaT); attesaT=setTimeout(svuota,600);
}
function svuota(){
  const body=inAttesa; inAttesa=null; if(!body) return coda;
  coda=coda.then(()=>api('POST',body)).then(j=>{ server=j; LSset('cache',JSON.stringify(j)); if(!inAttesa) LSset('pending',null); dalServer(); emit('eventi_bot'); emit('piano'); stato('Salvato alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+': Claude e Telegram vedono già le modifiche.'); })
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
const COND=c=> c===0?'sereno': c<=2?'poco nuvoloso': c===3?'nuvoloso': (c===45||c===48)?'nebbia': c>=95?'temporale': ((c>=71&&c<=77)||c===85||c===86)?'neve': 'pioggia';
async function meteo(lat,lon){
  const q=new URLSearchParams({latitude:lat,longitude:lon,timezone:'auto',past_days:'3',forecast_days:'8',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max'});
  const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q); if(!r.ok) throw new Error('Open-Meteo '+r.status);
  const j=await r.json(), d=j.daily;
  const out={source:'open-meteo',updatedAt:new Date().toISOString(),lat,lon,suolo:null,notte:null,days:d.time.map((t,i)=>({date:t,cond:COND(d.weather_code[i]),tmax:d.temperature_2m_max[i],tmin:d.temperature_2m_min[i],
    rain:d.precipitation_sum[i]??0,prob:d.precipitation_probability_max[i],et0:d.et0_fao_evapotranspiration[i]??0,wind:d.wind_speed_10m_max[i]}))};
  // umidità del suolo e temperature della notte (stessi calcoli del bot): se non arrivano, il resto funziona lo stesso
  try{
    const r2=await fetch('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:lat,longitude:lon,timezone:'auto',forecast_days:'2',hourly:ORARIO_PARAMS}));
    if(r2.ok){ const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:j.timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
      Object.assign(out, datiOrari((await r2.json()).hourly, p.year+'-'+p.month+'-'+p.day, +p.hour)); }
  }catch(e){}
  return out;
}
async function caricaMeteo(forza){
  const loc=docs.giardino?.location; if(!loc) return;
  const c=LSjson('meteo');
  if(!forza&&c&&c.lat===loc.lat&&c.lon===loc.lon&&Date.now()-Date.parse(c.updatedAt)<3600e3){ docs.meteo_bot=c; return; }
  try{ docs.meteo_bot=await meteo(loc.lat,loc.lon); LSset('meteo',JSON.stringify(docs.meteo_bot)); }
  catch(e){ docs.meteo_bot=c; stato('Meteo non disponibile: uso gli ultimi dati salvati.'); }
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
async function aggiorna(){
  if(inAttesa) await svuota(); else await coda;
  const rev=server?.rev;
  await scarica(); await caricaMeteo(true);
  ['meteo_bot','eventi_bot','piano'].forEach(emit);
  if(server?.rev!==rev && typeof window.applyMain==='function'){ window.applyMain(docs.giardino); window.renderAll?.(); }
}
window.GiardinoNet={
  codice:()=>code,
  usaCodice(c){ c=String(c||'').trim().toUpperCase(); if(!/^[A-Z0-9-]{16,64}$/.test(c)) return false; LSset('code',c); LSset('cache',null); location.reload(); return true; },
  mcp:(action,extra)=>action?api('POST',{action,...(extra||{})},'mcp'):api('GET',null,'mcp'),
  telegram:(action,extra)=>action?api('POST',{action,...(extra||{})},'telegram'):api('GET',null,'telegram'),
  aggiorna,
  async geocodifica(q){
    const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:q,count:'1',language:'it',format:'json'}));
    const x=(await r.json()).results?.[0]; if(!x) return null;
    return {name:x.name,detail:[x.admin1,x.country].filter(Boolean).join(', '),lat:+x.latitude.toFixed(4),lon:+x.longitude.toFixed(4),alt:x.elevation??null,clima:''};
  }
};
// aggiorna da solo quando torni sull'app e ogni 2 minuti mentre è aperta (risposte di Telegram, modifiche di Claude)
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') aggiorna(); });
setInterval(()=>{ if(document.visibilityState==='visible') aggiorna(); },120000);
window.addEventListener('online',()=>{ if(inAttesa) svuota(); });
if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('/sw.js').catch(()=>{});
window.addEventListener('pagehide',()=>{ if(inAttesa&&navigator.onLine!==false){ try{ if(navigator.sendBeacon?.(API+'?code='+encodeURIComponent(code),new Blob([JSON.stringify(inAttesa)],{type:'application/json'}))){ inAttesa=null; LSset('pending',null); } }catch(e){} } });

const caps={ db:{doc, collection:()=>{ throw new Error('non disponibile'); }}, user:{ id:async()=>'locale', me:async()=>({id:'locale',name:''}) }, mcp:{} };
window.claude={ use:async n=>caps[n]??null };
})();
