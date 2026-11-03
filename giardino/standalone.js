// Giardino — versione autonoma (GitHub Pages), senza abbonamento Claude.
// Sostituisce le funzioni di claude.ai che l'app usa (window.claude.use):
//   sample → API Anthropic con Claude Haiku 5.5, effort "high" (chiave API dell'utente, salvata solo in questo browser)
//   db     → localStorage + file nel branch giardino-dati del repo (token GitHub dell'utente)
//   meteo  → Open-Meteo direttamente dal browser
//   sync   → avvia il workflow del bot su GitHub Actions
(function(){
'use strict';
const REPO='fedefabbro2008-bit/Palestra', BR='giardino-dati', WF='giardino-notifiche.yml';
const MODEL='claude-haiku-5-5', EFFORT='high';
const LS=k=>{ try{ return localStorage.getItem('giardino:sa:'+k); }catch(e){ return null; } };
const LSset=(k,v)=>{ try{ if(v==null) localStorage.removeItem('giardino:sa:'+k); else localStorage.setItem('giardino:sa:'+k,v); }catch(e){} };
const LSjson=k=>{ try{ return JSON.parse(LS(k)||'null'); }catch(e){ return null; } };
const keys={ get api(){ return LS('apikey')||''; }, get gh(){ return LS('ghtoken')||''; } };
const stato=(msg,err)=>{ const el=document.getElementById('saStatus'); if(el) el.textContent=msg; if(err&&typeof window.showNote==='function') window.showNote('err',msg); };

/* ---------------- GitHub ---------------- */
async function gh(method, path, body){
  const h={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(keys.gh) h.Authorization='Bearer '+keys.gh;
  if(body) h['Content-Type']='application/json';
  let r;
  try{ r=await fetch('https://api.github.com/repos/'+REPO+path,{method,headers:h,body:body?JSON.stringify(body):undefined,cache:'no-store'}); }
  catch(e){ const x=new Error('GitHub non raggiungibile: controlla la connessione.'); x.status=0; throw x; }
  if(r.status===204) return null;
  const j=await r.json().catch(()=>null);
  if(!r.ok){ const x=new Error(r.status===401?'Token GitHub non valido o scaduto.':r.status===403||r.status===404&&keys.gh?'Il token GitHub non ha i permessi necessari (Contents e Actions in lettura e scrittura sul repo Palestra).':(j?.message||'GitHub '+r.status)); x.status=r.status; throw x; }
  return j;
}
const b64dec=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g,'')),c=>c.charCodeAt(0)));
async function leggiFile(name){
  try{ const j=await gh('GET','/contents/'+name+'?ref='+BR); return JSON.parse(b64dec(j.content)); }
  catch(e){ if(e.status===404) return null; throw e; }
}
// Un solo commit con più file sul branch dei dati (riprova se il bot ha appena scritto)
async function commitFiles(files, msg){
  for(let i=0;i<3;i++){
    const ref=await gh('GET','/git/ref/heads/'+BR), base=ref.object.sha;
    const c=await gh('GET','/git/commits/'+base);
    const tree=await gh('POST','/git/trees',{base_tree:c.tree.sha,tree:Object.entries(files).map(([path,content])=>({path,mode:'100644',type:'blob',content}))});
    if(tree.sha===c.tree.sha) return 'invariato';
    const nc=await gh('POST','/git/commits',{message:msg,tree:tree.sha,parents:[base]});
    try{ await gh('PATCH','/git/refs/heads/'+BR,{sha:nc.sha}); return 'ok'; }
    catch(e){ if(e.status!==422||i===2) throw e; }
  }
}

/* ---------------- Meteo (Open-Meteo) ---------------- */
const COND=c=> c===0?'sereno': c<=2?'poco nuvoloso': c===3?'nuvoloso': (c===45||c===48)?'nebbia': c>=95?'temporale': ((c>=71&&c<=77)||c===85||c===86)?'neve': 'pioggia';
async function meteo(lat,lon){
  const q=new URLSearchParams({latitude:lat,longitude:lon,timezone:'auto',past_days:'3',forecast_days:'8',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max'});
  const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q);
  if(!r.ok) throw new Error('Open-Meteo '+r.status);
  const d=(await r.json()).daily;
  return {source:'open-meteo',updatedAt:new Date().toISOString(),lat,lon,days:d.time.map((t,i)=>({date:t,cond:COND(d.weather_code[i]),tmax:d.temperature_2m_max[i],tmin:d.temperature_2m_min[i],
    rain:d.precipitation_sum[i]??0,prob:d.precipitation_probability_max[i],et0:d.et0_fao_evapotranspiration[i]??0,wind:d.wind_speed_10m_max[i]}))};
}

/* ---------------- Documenti ---------------- */
const docs={}, subs={}, caricati={};
const snap=n=>({id:n,exists:docs[n]!=null,data:()=>docs[n]??undefined,metadata:{fromCache:false,hasPendingWrites:false}});
const emit=n=>(subs[n]||[]).forEach(f=>{ try{ f(snap(n)); }catch(e){ console.error(e); } });
async function caricaGiardino(){
  const locale=LSjson('giardino');
  let remoto=null;
  if(keys.gh){ try{ remoto=await leggiFile('app.json'); }catch(e){ stato('Non riesco a leggere i dati da GitHub: '+e.message,true); } }
  docs.giardino = (remoto && (!locale || Date.parse(remoto.updatedAt||0)>Date.parse(locale.updatedAt||0))) ? remoto : locale;
  if(docs.giardino) LSset('giardino',JSON.stringify(docs.giardino));
}
async function caricaMeteo(forza){
  const loc=docs.giardino?.location; if(!loc) return;
  const c=LSjson('meteo_bot');
  if(!forza && c && c.lat===loc.lat && c.lon===loc.lon && Date.now()-Date.parse(c.updatedAt)<3600e3){ docs.meteo_bot=c; return; }
  try{ docs.meteo_bot=await meteo(loc.lat,loc.lon); LSset('meteo_bot',JSON.stringify(docs.meteo_bot)); }
  catch(e){ docs.meteo_bot=c; stato('Meteo non disponibile ('+e.message+'): uso gli ultimi dati salvati.'); }
}
async function caricaBot(){
  try{ const a=await leggiFile('per-app.json'); if(a){ docs.piano_bot=a.piano||null; docs.eventi_bot={aggiornato:a.aggiornato,eventi:a.eventi||[]}; LSset('per_app',JSON.stringify(a)); } }
  catch(e){ const a=LSjson('per_app'); if(a){ docs.piano_bot=a.piano||null; docs.eventi_bot={aggiornato:a.aggiornato,eventi:a.eventi||[]}; } }
}
function carica(n){
  if(caricati[n]) return caricati[n];
  const p = n==='giardino' ? caricaGiardino()
    : n==='meteo_bot' ? carica('giardino').then(()=>caricaMeteo(false))
    : (n==='piano_bot'||n==='eventi_bot') ? (caricati.bot||(caricati.bot=caricaBot()))
    : Promise.resolve().then(()=>{ docs[n]=LSjson(n); });
  return caricati[n]=p;
}
let salvaT=null, inSalvataggio=Promise.resolve();
function salvaRemoto(){
  clearTimeout(salvaT);
  if(!keys.gh){ stato('Salvato solo su questo dispositivo: aggiungi il token GitHub per mandare le piante al bot.'); return; }
  salvaT=setTimeout(()=>{
    const d=docs.giardino; if(!d) return;
    const files={'app.json':JSON.stringify(d,null,2)+'\n','eventi.json':JSON.stringify(d.eventi_app||[],null,2)+'\n'};
    if(d.export_bot?.posizione && d.export_bot.piante?.length) files['piante.json']=JSON.stringify(d.export_bot,null,2)+'\n';
    inSalvataggio=inSalvataggio.then(()=>commitFiles(files,'Giardino: aggiorna dall\'app'))
      .then(r=>stato(r==='invariato'?'Dati già aggiornati su GitHub.':'Salvato su GitHub alle '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+': il bot userà questi dati.'))
      .catch(e=>stato('Salvataggio su GitHub non riuscito: '+e.message+' Le modifiche restano su questo dispositivo.',true));
  },2500);
}
function doc(path){
  const n=String(path).split('/').pop();
  return {
    id:n, path,
    get: async()=>{ await carica(n); return snap(n); },
    set: async data=>{
      const prima=docs[n]?.location;
      docs[n]=data; LSset(n,JSON.stringify(data));
      if(n==='giardino'){ salvaRemoto(); const l=data.location; if(l&&(!prima||prima.lat!==l.lat||prima.lon!==l.lon)){ caricaMeteo(true).then(()=>emit('meteo_bot')); } }
      emit(n);
    },
    update: async data=>{ docs[n]={...(docs[n]||{}),...data}; LSset(n,JSON.stringify(docs[n])); emit(n); },
    onSnapshot:(fn)=>{ (subs[n]=subs[n]||[]).push(fn); carica(n).then(()=>fn(snap(n))); return ()=>{ subs[n]=subs[n].filter(f=>f!==fn); }; }
  };
}

/* ---------------- Claude (API Anthropic) ---------------- */
async function immagine(blob){
  const bmp=await createImageBitmap(blob);
  const s=Math.min(1,1568/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
  c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  return {type:'image',source:{type:'base64',media_type:'image/jpeg',data:c.toDataURL('image/jpeg',0.85).split(',')[1]}};
}
async function chiedi(input, opts={}, maxTokens=16000, effort=EFFORT){
  if(!keys.api) throw {code:'no_key',message:'Manca la chiave API Anthropic'};
  const content=[];
  if(opts.images) for(const b of Array.from(opts.images)) content.push(await immagine(b));
  content.push({type:'text',text:typeof input==='string'?input:input.map(t=>t.content).join('\n\n')});
  let r;
  try{
    r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:opts.signal,
      headers:{'content-type':'application/json','x-api-key':keys.api,'anthropic-version':'2026-10-21','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:MODEL,max_tokens:maxTokens,output_config:{effort},messages:[{role:'user',content}]})});
  }catch(e){ if(e?.name==='AbortError') throw {code:'cancelled'}; throw {code:'network',message:String(e?.message||e)}; }
  const j=await r.json().catch(()=>null);
  if(!r.ok){
    const code={401:'bad_key',403:'bad_key',429:'rate_limited',529:'upstream_error'}[r.status]||(r.status>=500?'upstream_error':'invalid_request');
    throw {code,message:j?.error?.message||('HTTP '+r.status)};
  }
  if(j.stop_reason==='refusal') throw {code:'refused'};
  const text=(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  if(!text.trim()) throw {code:'empty_completion'};
  const u=j.usage||{}; LSset('ultimo_uso',JSON.stringify({in:u.input_tokens,out:u.output_tokens,quando:new Date().toISOString()}));
  return {text, truncated:j.stop_reason==='max_tokens'};
}
function parseJSON(t){
  try{ return JSON.parse(t); }catch(e){}
  const f=t.match(/```(?:json)?\s*([\s\S]*?)```/); if(f){ try{ return JSON.parse(f[1]); }catch(e){} }
  const a=Math.min(...['{','['].map(c=>t.indexOf(c)).filter(i=>i>=0)), b=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']'));
  if(isFinite(a)&&b>a){ try{ return JSON.parse(t.slice(a,b+1)); }catch(e){} }
  throw {code:'invalid_json',text:t};
}
const sample=async(input,opts={})=>{ const r=await chiedi(input,opts); try{ opts.onText?.({text:r.text,delta:r.text}); }catch(e){} return r; };
sample.json=async(input,opts={})=>{ const r=await chiedi(input+'\n\nLa risposta viene letta da un programma: scrivi solo il JSON richiesto, senza altro testo.',opts); if(r.truncated) throw {code:'invalid_json',text:r.text}; return parseJSON(r.text); };
sample.limits=async()=>({maxPromptBytes:262144,images:{maxCount:5}});

/* ---------------- API per l'app ---------------- */
window.GiardinoSA={
  modello:'Claude Haiku 5.5 · effort alto',
  chiavi:()=>({api:!!keys.api, gh:!!keys.gh}),
  salvaChiavi(api,tok){ if(api!=null) LSset('apikey',api.trim()||null); if(tok!=null) LSset('ghtoken',tok.trim()||null); },
  ultimoUso:()=>LSjson('ultimo_uso'),
  async prova(){
    const out=[];
    if(keys.api){ try{ await chiedi('Rispondi solo: OK',{},50,'low'); out.push('Claude: ok'); }catch(e){ out.push('Claude: '+(e.code==='bad_key'?'chiave non valida':e.message||e.code)); } }
    else out.push('Claude: manca la chiave');
    if(keys.gh){ try{ await gh('GET','/git/ref/heads/'+BR); await gh('GET','/actions/workflows/'+WF); out.push('GitHub: ok'); }catch(e){ out.push('GitHub: '+e.message); } }
    else out.push('GitHub: manca il token');
    return out.join(' · ');
  },
  // Salva subito, avvia il bot in modalità "aggiorna" e aspetta i nuovi dati (meteo, piano, risposte di Telegram)
  async sync(onStato){
    if(!keys.gh) throw new Error('Serve il token GitHub (scheda Impostazioni).');
    if(salvaT){ clearTimeout(salvaT); salvaT=null; const d=docs.giardino; if(d){ const files={'app.json':JSON.stringify(d,null,2)+'\n','eventi.json':JSON.stringify(d.eventi_app||[],null,2)+'\n'}; if(d.export_bot?.posizione&&d.export_bot.piante?.length) files['piante.json']=JSON.stringify(d.export_bot,null,2)+'\n'; await commitFiles(files,'Giardino: aggiorna dall\'app'); } }
    await inSalvataggio;
    const prima=docs.eventi_bot?.aggiornato||'';
    await gh('POST','/actions/workflows/'+WF+'/dispatches',{ref:'main',inputs:{modo:'aggiorna'}});
    onStato?.('Bot avviato su GitHub: attendo i risultati…');
    await caricaMeteo(true); emit('meteo_bot');
    for(let i=0;i<12;i++){
      await new Promise(r=>setTimeout(r,20000));
      caricati.bot=null; await caricaBot();
      if((docs.eventi_bot?.aggiornato||'')!==prima){ emit('piano_bot'); emit('eventi_bot'); return 'ok'; }
    }
    return 'lento';
  },
  async aggiorna(){ await caricaMeteo(true); caricati.bot=null; await caricaBot(); ['meteo_bot','piano_bot','eventi_bot'].forEach(emit); }
};
let ultimoAgg=Date.now();
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&Date.now()-ultimoAgg>30*60e3){ ultimoAgg=Date.now(); window.GiardinoSA.aggiorna(); } });

const caps={ sample, db:{doc, collection:()=>{ throw new Error('non disponibile'); }}, user:{ id:async()=>'locale', me:async()=>({id:'locale',name:''}) }, mcp:{ callTool:async()=>{ throw {code:'tool_error',message:'non disponibile'}; } } };
window.claude={ use:async n=>caps[n]??null };
})();
