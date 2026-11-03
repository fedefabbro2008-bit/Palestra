// Giardino — bot Telegram. Eseguito da GitHub Actions ogni 15 minuti (.github/workflows/giardino-notifiche.yml).
// Node 20+, nessuna dipendenza. Il calcolo è in modello.mjs (lo stesso dell'app).
//
// A ogni esecuzione:
//   1. legge i pulsanti premuti su Telegram (Fatto, Era umida, Salto, Secca, Concimata) e li registra;
//   2. dopo l'ora del mattino (default 7) invia una volta al giorno il piano, solo se c'è qualcosa da fare;
//   3. dopo l'ora della sera (default 19) avvisa una volta se domani c'è gelo, caldo forte o vento;
//   4. scrive stato.json (memoria del bot) e per-app.json (meteo, piano ed eventi da portare nell'app).
//
// Variabili: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (obbligatorie), ANTHROPIC_API_KEY, CLAUDE_MODEL (default claude-haiku-5-5), CLAUDE_EFFORT (default high) (facoltative),
//            MODO = auto | aggiorna (ricalcola senza inviare) | prova (invia subito il messaggio del mattino).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as M from './modello.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
// I dati stanno nel branch giardino-dati (cartella indicata da GIARDINO_DATI); senza variabile, accanto allo script.
const DATI = process.env.GIARDINO_DATI || DIR;
const F = { piante:join(DATI,'piante.json'), eventi:join(DATI,'eventi.json'), stato:join(DATI,'stato.json'), perApp:join(DATI,'per-app.json') };
const MODO = (process.env.MODO||'auto').trim() || 'auto';
const fmt=(n,d=1)=>(Math.round(n*10**d)/10**d).toLocaleString('it-IT');
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const corto=s=>{ s=String(s||''); return s.length>18?s.slice(0,17)+'…':s; };
const readJson=async(f,def)=>{ try{ return JSON.parse(await readFile(f,'utf8')); }catch{ return def; } };

/* ---------------- Meteo (Open-Meteo) ---------------- */
const WMO_COND=c=> c===0?'sereno': c<=2?'poco nuvoloso': c===3?'nuvoloso': (c===45||c===48)?'nebbia': c>=95?'temporale': ((c>=71&&c<=77)||c===85||c===86)?'neve': 'pioggia';
async function meteo(pos){
  const q=new URLSearchParams({latitude:pos.lat,longitude:pos.lon,timezone:'auto',past_days:'3',forecast_days:'8',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max'});
  const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q);
  if(!r.ok) throw new Error('Open-Meteo HTTP '+r.status+': '+(await r.text()).slice(0,200));
  const j=await r.json(), d=j.daily;
  const days=d.time.map((t,i)=>({date:t,code:d.weather_code[i],cond:WMO_COND(d.weather_code[i]),tmax:d.temperature_2m_max[i],tmin:d.temperature_2m_min[i],
    rain:d.precipitation_sum[i]??0,prob:d.precipitation_probability_max[i],et0:d.et0_fao_evapotranspiration[i]??0,wind:d.wind_speed_10m_max[i]}));
  return {tz:j.timezone||'Europe/Rome', days};
}
function oraLocale(tz){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return {oggi:`${p.year}-${p.month}-${p.day}`, ora:+p.hour};
}

/* ---------------- Telegram ---------------- */
async function tg(method,payload,{ignora=false}={}){
  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload||{})});
  const j=await r.json().catch(()=>({}));
  if(!j.ok){ if(ignora){ console.warn(`Telegram ${method}: ${j.description||r.status}`); return null; } throw new Error(`Telegram ${method}: ${j.description||r.status}`); }
  return j.result;
}
const TIPI={f:'fatto',s:'saltato',u:'umido',a:'secco',c:'concime'};
const ETICHETTE={fatto:'innaffiata',saltato:'saltata',umido:'era ancora umida',secco:'era secca, innaffiata',concime:'concimata'};

async function leggiPulsanti(stato, piante){
  const ups=await tg('getUpdates',{offset:(stato.telegram_offset||0)+1,timeout:0,allowed_updates:['callback_query','message']});
  let nuovi=0;
  for(const u of ups){
    stato.telegram_offset=Math.max(stato.telegram_offset||0,u.update_id);
    const cq=u.callback_query; if(!cq) continue;
    const chat=String(cq.message?.chat?.id??'');
    if(chat!==String(process.env.TELEGRAM_CHAT_ID)){ await tg('answerCallbackQuery',{callback_query_id:cq.id},{ignora:true}); continue; }
    const [k,data,pid,t]=String(cq.data||'').split('|');
    const tipo=TIPI[t], p=piante.find(x=>x.id===pid);
    if(k!=='g'||!tipo||!/^\d{4}-\d{2}-\d{2}$/.test(data||'')){ await tg('answerCallbackQuery',{callback_query_id:cq.id,text:'Già registrato'},{ignora:true}); continue; }
    const doppio=stato.eventi.some(e=>e.plantId===pid&&e.data===data&&e.tipo===tipo&&e.fonte==='telegram');
    if(!doppio){
      const g=stato.ultimo_piano?.piante?.find(x=>x.id===pid)?.giorni?.find(x=>x.data===data);
      stato.eventi.push({id:'tg-'+cq.id,plantId:pid,tipo,data,fonte:'telegram',ts:new Date((cq.message?.date||0)*1000||Date.now()).toISOString(),
        ...(tipo==='fatto'||tipo==='secco'?{litri:g?.litri??null}:{})});
      nuovi++;
    }
    const nome=p?.nome||pid;
    await tg('answerCallbackQuery',{callback_query_id:cq.id,text:`Registrato: ${nome} ${ETICHETTE[tipo]}`},{ignora:true});
    // sostituisci i pulsanti di quella pianta con una conferma
    const kb=cq.message?.reply_markup?.inline_keyboard;
    if(kb){
      const gruppo=t==='c'?'c':'w';
      const nuova=kb.map(row=>{
        const cb=row.map(b=>b.callback_data||'');
        const stessa=cb.some(c=>c.startsWith(`g|${data}|${pid}|`)), suo=cb.some(c=>c.endsWith('|c'))?'c':'w';
        return stessa&&suo===gruppo ? [{text:`✔ ${corto(nome)}: ${ETICHETTE[tipo]}`,callback_data:'x'}] : row;
      });
      await tg('editMessageReplyMarkup',{chat_id:cq.message.chat.id,message_id:cq.message.message_id,reply_markup:{inline_keyboard:nuova}},{ignora:true});
    }
  }
  return nuovi;
}

/* ---------------- Claude (facoltativo) ---------------- */
const SCHEMA={type:'object',additionalProperties:false,required:['avvisi','piante'],properties:{
  avvisi:{type:'array',items:{type:'string'}},
  piante:{type:'array',items:{type:'object',additionalProperties:false,required:['id','giorni','consigli'],properties:{
    id:{type:'string'},consigli:{type:'array',items:{type:'string'}},
    giorni:{type:'array',items:{type:'object',additionalProperties:false,required:['data','azione','litri','momento','motivo'],properties:{
      data:{type:'string',format:'date'},azione:{type:'string',enum:['innaffia','salta','controlla']},litri:{type:'number'},
      momento:{type:'string',enum:['mattina presto','sera','metà giornata','indifferente']},motivo:{type:'string'}}}}}}}}};
const SYSTEM=`Sei un agronomo esperto di irrigazione di orti, giardini e piante in vaso. Ricevi in JSON posizione, meteo (giorni passati e 7 di previsione con ET0 FAO-56), piante (specie, fase di crescita, per i vasi volume, diametro e altre piante nello stesso vaso, ore di luce diretta, ambiente aperto/riparato/interno, ultima innaffiatura, calcolo dell'app in litri con la correzione appresa dalle risposte dell'utente), eventuale vacanza e una stima locale da bilancio idrico. Per ogni pianta o vaso decidi l'azione per ciascuno dei 7 giorni previsti (stesse date, in ordine): "innaffia" con i litri totali per la voce, "controlla" (verificare l'umidità con un dito) o "salta". Parti dalla stima locale e correggila con la tua conoscenza di specie, fase, stagione, clima locale, gelo, caldo e ristagni. Vasi piccoli si asciugano prima e non possono trattenere più della loro riserva; meno luce = meno consumo; in casa niente pioggia; con più piante nello stesso vaso il consumo si somma e decide la più delicata. Durante la vacanza nessuno innaffia: il giorno prima della partenza bagna a fondo. "motivo" al massimo 12 parole; "consigli" da 0 a 2 brevi; "avvisi" solo per eventi meteo rilevanti. Usa gli id ricevuti. Scrivi in italiano.`;
async function pianoClaude(input){
  const model=process.env.CLAUDE_MODEL||'claude-haiku-5-5';
  const body={model,max_tokens:16000,output_config:{effort:process.env.CLAUDE_EFFORT||'high',format:{type:'json_schema',schema:SCHEMA}},system:SYSTEM,messages:[{role:'user',content:JSON.stringify(input)}]};
  const headers={'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2026-10-21'};
  if(model==='claude-opus-5-5'||model==='claude-sonnet-5-5'){ headers['anthropic-beta']='server-side-fallback-2026-07-01'; body.fallbacks='default'; }
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers,body:JSON.stringify(body)});
  const j=await r.json().catch(()=>null);
  if(!r.ok) throw new Error('Claude HTTP '+r.status+': '+(j?.error?.message||''));
  if(j.stop_reason==='refusal'||j.stop_reason==='max_tokens') throw new Error('Claude stop_reason '+j.stop_reason);
  return JSON.parse((j.content||[]).filter(b=>b.type==='text').pop()?.text);
}

/* ---------------- Calcolo del piano ---------------- */
async function calcola(cfg, piante, eventi, meteoDati, oggi){
  const lat=cfg.posizione.lat;
  const past=meteoDati.days.filter(d=>d.date<oggi).slice(-3), fut=meteoDati.days.filter(d=>d.date>=oggi).slice(0,7);
  const base=M.pianoLocale({piante,past,fut,eventi,oggi,lat,vacanza:cfg.vacanza});
  let piano={...base,fonte:'stima locale'};
  if(process.env.ANTHROPIC_API_KEY){
    try{
      const c=await pianoClaude({oggi,posizione:cfg.posizione,vacanza:cfg.vacanza||null,meteo_passato:past,meteo_previsto:fut,
        piante:piante.map(p=>{const k=M.params(p,{oggi,lat,eventi});return {id:p.id,nome:p.nome,specie:k.sp.nome,fase:k.fa.nome+(k.faseAuto?' (calcolata)':''),num:k.num,coltivazione:p.colt,
          vaso:k.vaso?{volume_litri:k.V,diametro_cm:Math.round(k.D*100)}:null,
          altre_piante_nel_vaso:k.membri.slice(1).map(m=>({specie:(M.SPECIE[m.specie]||M.SPECIE.altro).nome,num:m.num})),
          ore_luce_diretta:k.h,ambiente:p.dove,ultima:M.ultimaInnaffiatura(p,eventi)||'non indicata',note:p.note||'',
          calcolo:{acqua_disponibile_litri:+k.tawL.toFixed(2),soglia_innaffiatura_litri:+k.rawL.toFixed(2),consumo_oggi_litri:+M.consumoL(k,fut[0]).toFixed(2),correzione_appresa:+k.calib.toFixed(2)}};}),
        stima_locale:base.piante.map(x=>({id:x.id,giorni:x.giorni.map(g=>({data:g.data,azione:g.azione,litri:g.litri}))}))});
      if(Array.isArray(c?.piante)&&c.piante.length){
        const ids=new Set(c.piante.map(x=>x.id));
        piano={avvisi:c.avvisi||[],piante:[...c.piante,...base.piante.filter(x=>!ids.has(x.id))],fonte:'Claude'};
      }
    }catch(e){ console.warn('Claude non disponibile, uso la stima locale:',e.message); }
  }
  return {piano,past,fut};
}
// Innaffiature notificate senza risposta: il giorno dopo si considerano fatte.
function aggiungiPresunti(stato, eventiTutti, oggi){
  for(const [data,lista] of Object.entries(stato.notificati||{})){
    if(data>=oggi) continue;
    for(const n of lista){
      const risposto=eventiTutti.some(e=>e.plantId===n.id&&e.data===data&&e.fonte!=='presunto');
      if(!risposto && !stato.eventi.some(e=>e.id===`pres-${data}-${n.id}`)) stato.eventi.push({id:`pres-${data}-${n.id}`,plantId:n.id,tipo:'fatto',data,fonte:'presunto',litri:n.litri??null});
    }
    delete stato.notificati[data];
  }
}

/* ---------------- Messaggi ---------------- */
function messaggioMattina(cfg, piante, piano, fut, oggi, eventi){
  const imp=cfg.impostazioni||{}, d0=fut[0], lat=cfg.posizione.lat;
  const righe={innaffia:[],controlla:[],concime:[]}, tastiera=[];
  for(const p of piante){
    const g=piano.piante.find(x=>x.id===p.id)?.giorni.find(x=>x.data===oggi);
    if(g?.azione==='innaffia'){
      righe.innaffia.push(`💧 <b>${esc(p.nome)}</b>: ${fmt(g.litri,g.litri<2?2:1)} L (${esc(M.dose(g.litri,imp))}), ${esc(g.momento)}\n      <i>${esc(g.motivo)}</i>`);
      tastiera.push([{text:'✅ '+corto(p.nome),callback_data:`g|${oggi}|${p.id}|f`},{text:'💧 Era umida',callback_data:`g|${oggi}|${p.id}|u`},{text:'⏭ Salto',callback_data:`g|${oggi}|${p.id}|s`}]);
    } else if(g?.azione==='controlla'){
      righe.controlla.push(`👆 <b>${esc(p.nome)}</b>: ${esc(g.motivo)}`);
      tastiera.push([{text:'🏜 '+corto(p.nome)+' secca',callback_data:`g|${oggi}|${p.id}|a`},{text:'💧 Umida, non serve',callback_data:`g|${oggi}|${p.id}|u`}]);
    }
    const c=M.concime(p,{oggi,lat,eventi});
    if(c.inStagione&&c.dovuto&&!M.inVacanza(cfg.vacanza,oggi)){
      righe.concime.push(`🌱 <b>${esc(p.nome)}</b>: ${esc(c.tipo)} (ogni ${c.freq} giorni)`);
      tastiera.push([{text:'🌱 '+corto(p.nome)+' concimata',callback_data:`g|${oggi}|${p.id}|c`}]);
    }
  }
  const dataLunga=new Date(oggi+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
  let msg=`🪴 <b>Giardino — ${esc(dataLunga)}</b>\n${esc(cfg.posizione.nome)} · ${esc(d0.cond)}, ${fmt(d0.tmin,0)}–${fmt(d0.tmax,0)} °C, pioggia ${fmt(d0.rain)} mm\n`;
  if(M.inVacanza(cfg.vacanza,oggi)) msg+=`\n🧳 <i>Sei in vacanza fino al ${esc(new Date(cfg.vacanza.al+'T12:00:00').toLocaleDateString('it-IT',{day:'numeric',month:'long'}))}: inoltra questo messaggio a chi bagna le piante.</i>\n`;
  if(cfg.esempio) msg+=`\n<i>Configurazione di esempio: le tue piante arrivano dall'app alla prossima sincronizzazione.</i>\n`;
  if(righe.innaffia.length) msg+=`\n<b>Da innaffiare</b>\n${righe.innaffia.join('\n')}\n`;
  if(righe.controlla.length) msg+=`\n<b>Da controllare con un dito</b>\n${righe.controlla.join('\n')}\n`;
  if(righe.concime.length) msg+=`\n<b>Da concimare</b>\n${righe.concime.join('\n')}\n`;
  const daFare=righe.innaffia.length+righe.controlla.length+righe.concime.length;
  if(!daFare) msg+=`\nOggi non c'è niente da fare. 🌤\n`;
  for(const a of (piano.avvisi||[]).slice(0,3)) msg+=`\n⚠️ ${esc(a)}`;
  const prossimi=fut.slice(1,4).map(d=>{ const n=piante.filter(p=>piano.piante.find(x=>x.id===p.id)?.giorni.find(g=>g.data===d.date&&g.azione==='innaffia')).length;
    return new Date(d.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'short'})+' '+(n?n+' 💧':'–'); }).join(' · ');
  msg+=`\n\nProssimi giorni: ${prossimi}`;
  if(tastiera.length) msg+=`\n<i>Se non premi nulla considero fatte le innaffiature.</i>`;
  msg+=`\n<i>Piano: ${esc(piano.fonte)}</i>`;
  return {msg, tastiera, daFare, innaffia:righe.innaffia.length};
}

/* ---------------- Main ---------------- */
async function main(){
  // Senza Telegram configurato: "aggiorna" calcola comunque meteo e piano per l'app,
  // "auto" (ogni 15 minuti) esce senza errori, "prova" spiega cosa manca.
  const haToken=!!process.env.TELEGRAM_BOT_TOKEN, haChat=!!process.env.TELEGRAM_CHAT_ID;
  if(!haToken||!haChat){
    if(MODO==='auto'){ console.log('Telegram non ancora configurato: niente da fare.'); return; }
    if(MODO==='prova'){
      if(!haToken) throw new Error('Manca il secret TELEGRAM_BOT_TOKEN (vedi giardino/LEGGIMI.md).');
      const ups=await tg('getUpdates');
      const chats=[...new Map(ups.map(u=>u.message?.chat||u.my_chat_member?.chat).filter(Boolean).map(c=>[c.id,c])).values()];
      console.log(chats.length?'Chat trovate (copia l\'id nel secret TELEGRAM_CHAT_ID):\n'+chats.map(c=>`  ${c.id}  ${c.first_name||c.title||''} ${c.username?'@'+c.username:''}`).join('\n')
        :'Nessuna chat trovata: apri il bot su Telegram, premi Avvia e scrivigli un messaggio, poi riavvia il workflow.');
      throw new Error('Manca il secret TELEGRAM_CHAT_ID.');
    }
    console.log('Telegram non ancora configurato: calcolo meteo e piano per l\'app senza inviare messaggi.');
  }
  const telegram=haToken&&haChat;
  const cfg=await readJson(F.piante,null);
  if(!cfg?.posizione) throw new Error('piante.json senza posizione.');
  const piante=(cfg.piante||[]).filter(p=>p&&p.id&&p.nome);
  const eventiApp=(await readJson(F.eventi,[])).filter(e=>e&&e.plantId&&e.data);
  let stato=await readJson(F.stato,{});
  if(!Array.isArray(stato.eventi)) stato={versione:2,telegram_offset:0,eventi:Object.entries(stato.ultime||{}).map(([id,data])=>({id:`pres-${data}-${id}`,plantId:id,tipo:'fatto',data,fonte:'presunto'})),notificati:{}};
  stato.notificati=stato.notificati||{};
  const prima=JSON.stringify(stato);

  const tz=stato.tz||'Europe/Rome';
  const {oggi,ora}=oraLocale(tz);
  const oraMattina=+(cfg.impostazioni?.ora_mattina??7), oraSera=+(cfg.impostazioni?.ora_sera??19);

  if(telegram){ const nuovi=await leggiPulsanti(stato,piante); if(nuovi) console.log(`Registrati ${nuovi} pulsanti.`); }

  const mattina = telegram && (MODO==='prova' || (ora>=oraMattina && ora<21 && stato.ultimo_invio!==oggi));
  const calcolo = mattina || MODO==='aggiorna';
  const sera = telegram && MODO!=='prova' && ora>=oraSera && ora<23 && stato.ultimo_avviso_sera!==oggi;

  if(calcolo||sera){
    const met=await meteo(cfg.posizione); stato.tz=met.tz;
    const oggiMeteo=oraLocale(met.tz).oggi;
    if(calcolo){
      aggiungiPresunti(stato,[...eventiApp,...stato.eventi],oggiMeteo);
      const eventi=[...eventiApp,...stato.eventi];
      const {piano,past,fut}=await calcola(cfg,piante,eventi,met,oggiMeteo);
      stato.meteo={aggiornato:new Date().toISOString(),giorni:[...past,...fut]};
      stato.ultimo_piano={data:oggiMeteo,fonte:piano.fonte,avvisi:piano.avvisi,piante:piano.piante};
      if(mattina){
        const {msg,tastiera,daFare,innaffia}=messaggioMattina(cfg,piante,piano,fut,oggiMeteo,eventi);
        console.log(`${oggiMeteo} ${cfg.posizione.nome}: ${innaffia} da innaffiare, ${daFare} cose da fare (${piano.fonte}).`);
        if(daFare||MODO==='prova'){
          const m=await tg('sendMessage',{chat_id:process.env.TELEGRAM_CHAT_ID,text:msg,parse_mode:'HTML',disable_web_page_preview:true,...(tastiera.length?{reply_markup:{inline_keyboard:tastiera}}:{})});
          console.log('Messaggio del mattino inviato.');
          stato.notificati[oggiMeteo]=piante.map(p=>({id:p.id,g:piano.piante.find(x=>x.id===p.id)?.giorni.find(g=>g.data===oggiMeteo)})).filter(x=>x.g?.azione==='innaffia').map(x=>({id:x.id,litri:x.g.litri}));
          stato.ultimo_messaggio=m?.message_id??null;
        } else console.log('Niente da fare oggi: nessun messaggio.');
        stato.ultimo_invio=oggiMeteo;
      }
    }
    if(sera){
      const domani=met.days.find(d=>d.date===M.addDays(oggiMeteo,1));
      const avv=M.avvisiDomani(piante,domani);
      if(avv.length){
        const ic={gelo:'🥶',caldo:'🔥',vento:'💨'};
        await tg('sendMessage',{chat_id:process.env.TELEGRAM_CHAT_ID,parse_mode:'HTML',text:`🌙 <b>Per domani</b>\n`+avv.map(a=>`${ic[a.tipo]} ${esc(a.testo)}`).join('\n')});
        console.log('Avviso serale inviato.');
      } else console.log('Nessun avviso per domani.');
      stato.ultimo_avviso_sera=oggiMeteo;
    }
  }
  // tieni solo gli ultimi 400 giorni di eventi
  const limite=M.addDays(oggi,-400); stato.eventi=stato.eventi.filter(e=>e.data>=limite);
  if(JSON.stringify(stato)!==prima || MODO==='aggiorna'){
    await writeFile(F.stato,JSON.stringify(stato,null,1)+'\n');
    await writeFile(F.perApp,JSON.stringify({
      aggiornato:new Date().toISOString(),
      meteo: stato.meteo ? {source:'open-meteo',updatedAt:stato.meteo.aggiornato,lat:cfg.posizione.lat,lon:cfg.posizione.lon,days:stato.meteo.giorni.map(({code,...d})=>d)} : null,
      piano: stato.ultimo_piano ? {createdAt:stato.meteo?.aggiornato||new Date().toISOString(),source:'bot',fonte:stato.ultimo_piano.fonte,lat:cfg.posizione.lat,lon:cfg.posizione.lon,
        data:{sintesi:'Piano del bot con il meteo reale di Open-Meteo'+(stato.ultimo_piano.fonte==='Claude'?', rifinito da Claude':'')+'.',avvisi:stato.ultimo_piano.avvisi||[],piante:stato.ultimo_piano.piante}} : null,
      eventi: stato.eventi.filter(e=>e.data>=M.addDays(oggi,-120))
    },null,1)+'\n');
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  main().catch(e=>{ console.error('Errore:',e.message); process.exit(1); });
}
