// Giardino — notifica Telegram giornaliera di innaffiatura.
// Eseguito da GitHub Actions (.github/workflows/giardino-notifiche.yml). Node 20+, nessuna dipendenza.
//
// Variabili d'ambiente:
//   TELEGRAM_BOT_TOKEN  (obbligatoria) token del bot creato con @BotFather
//   TELEGRAM_CHAT_ID    (obbligatoria) chat a cui scrivere; se manca, lo script elenca le chat trovate
//   ANTHROPIC_API_KEY   (facoltativa)  se presente, Claude rifinisce il piano; altrimenti stima locale FAO-56
//   CLAUDE_MODEL        (facoltativa)  default claude-opus-5-5
//   INVIA_SEMPRE        "true" per inviare anche nei giorni senza innaffiature (test)

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const FILE_PIANTE = join(DIR, 'piante.json');
const FILE_STATO = join(DIR, 'stato.json');

/* ---------- Modello (stesso dell'app) ---------- */
export const SPECIE = {
  pomodoro:{nome:'Pomodoro',kc:[0.6,0.85,1.15,0.8,0.3],area:0.30,radici:0.6,p:0.40},
  zucchina:{nome:'Zucchina',kc:[0.5,0.75,1.0,0.8,0.3],area:0.80,radici:0.6,p:0.50},
  peperone:{nome:'Peperone / peperoncino',kc:[0.6,0.8,1.05,0.9,0.3],area:0.20,radici:0.5,p:0.30},
  melanzana:{nome:'Melanzana',kc:[0.6,0.8,1.05,0.9,0.3],area:0.30,radici:0.6,p:0.45},
  lattuga:{nome:'Lattuga / insalate',kc:[0.7,0.85,1.0,0.95,0.3],area:0.06,radici:0.3,p:0.30},
  fagiolo:{nome:'Fagiolo / fagiolino',kc:[0.5,0.75,1.05,0.9,0.3],area:0.15,radici:0.5,p:0.45},
  fragola:{nome:'Fragola',kc:[0.4,0.6,0.85,0.75,0.3],area:0.08,radici:0.25,p:0.20},
  basilico:{nome:'Basilico',kc:[0.6,0.8,1.0,0.9,0.3],area:0.05,radici:0.25,p:0.30},
  prezzemolo:{nome:'Prezzemolo / erbe tenere',kc:[0.6,0.8,0.95,0.9,0.4],area:0.05,radici:0.3,p:0.35},
  rosmarino:{nome:'Rosmarino / salvia / timo',kc:[0.35,0.4,0.5,0.45,0.25],area:0.25,radici:0.6,p:0.65},
  lavanda:{nome:'Lavanda',kc:[0.35,0.4,0.5,0.45,0.25],area:0.30,radici:0.6,p:0.65},
  agrumi:{nome:'Agrumi (limone, arancio…)',kc:[0.65,0.65,0.7,0.7,0.45],area:0.60,radici:0.8,p:0.50},
  olivo:{nome:'Olivo',kc:[0.5,0.55,0.65,0.65,0.4],area:1.50,radici:1.0,p:0.65},
  rosa:{nome:'Rosa',kc:[0.6,0.75,0.9,0.8,0.35],area:0.35,radici:0.5,p:0.45},
  ortensia:{nome:'Ortensia',kc:[0.7,0.9,1.1,0.9,0.35],area:0.50,radici:0.4,p:0.35},
  geranio:{nome:'Geranio / fiori da balcone',kc:[0.6,0.75,0.9,0.8,0.35],area:0.08,radici:0.25,p:0.40},
  prato:{nome:'Prato',kc:[0.8,0.85,0.95,0.9,0.6],area:10,radici:0.2,p:0.40},
  succulenta:{nome:'Succulenta / cactus',kc:[0.25,0.3,0.35,0.3,0.1],area:0.04,radici:0.2,p:0.85},
  appartamento:{nome:'Pianta da appartamento',kc:[0.5,0.6,0.7,0.6,0.4],area:0.10,radici:0.3,p:0.50},
  altro:{nome:'Altra pianta',kc:[0.5,0.7,0.85,0.7,0.35],area:0.25,radici:0.5,p:0.50}
};
export const FASI = {
  germinazione:{nome:'Semina / germinazione',kc:0,radici:0.25,p:0.20},
  piantina:{nome:'Piantina / trapianto',kc:0,radici:0.45,p:0.30},
  vegetativa:{nome:'Crescita vegetativa',kc:1,radici:0.8,p:null},
  fioritura:{nome:'Fioritura',kc:2,radici:1,p:null},
  fruttificazione:{nome:'Fruttificazione',kc:2,radici:1,p:null},
  maturazione:{nome:'Maturazione / raccolta',kc:3,radici:1,p:null},
  riposo:{nome:'Riposo vegetativo',kc:4,radici:1,p:null}
};
const LUCE_DA_ESPO = {sole:8, mezzombra:4, ombra:2};
const WMO = {0:'sereno',1:'poco nuvoloso',2:'parz. nuvoloso',3:'coperto',45:'nebbia',48:'nebbia',51:'pioviggine',53:'pioviggine',55:'pioviggine',61:'pioggia debole',63:'pioggia',65:'pioggia forte',66:'pioggia gelata',67:'pioggia gelata',71:'neve debole',73:'neve',75:'neve forte',77:'neve',80:'rovesci',81:'rovesci',82:'rovesci forti',85:'neve',86:'neve',95:'temporale',96:'temporale con grandine',99:'temporale con grandine'};

// Stesso modello dell'app (giardino-app): bilancio idrico in litri per vaso o aiuola.
export function luceOre(p){ const h=Number(p.luce); return p.luce!=null&&p.luce!==''&&isFinite(h) ? Math.max(0,Math.min(14,h)) : (LUCE_DA_ESPO[p.espo] ?? 6); }
const fattoreLuce = h => 0.35 + 0.65*Math.min(h,9)/8;   // 0 h → 35%, 8 h → 100%
const et0Casa = h => 0.8 + 0.15*Math.min(h,12);           // mm/giorno in casa in base alla luce
function membri(p){
  const main={specie:p.specie,fase:p.fase,num:Math.max(1,Math.round(+p.num||1))};
  const altri=p.colt==='vaso'&&Array.isArray(p.consociate)?p.consociate.filter(c=>c&&SPECIE[c.specie]).map(c=>({specie:c.specie,fase:FASI[c.fase]?c.fase:p.fase,num:Math.max(1,Math.round(+c.num||1))})):[];
  return [main,...altri];
}
export function params(p){
  const sp=SPECIE[p.specie]||SPECIE.altro, fa=FASI[p.fase]||FASI.vegetativa;
  const m=membri(p), nTot=m.reduce((a,x)=>a+x.num,0);
  const h=luceOre(p), interno=p.dove==='interno', fl=interno?1:fattoreLuce(h);
  let kcA=0, chioma=0, pMin=1;
  for(const x of m){ const s=SPECIE[x.specie]||SPECIE.altro, f=FASI[x.fase]||FASI.vegetativa, a=s.area*x.num; kcA+=s.kc[f.kc]*a; chioma+=a; pMin=Math.min(pMin,f.p??s.p); }
  if(+p.area>0){ kcA*=(+p.area)/chioma; chioma=+p.area; }
  if(p.colt==='vaso'){
    const V=Math.max(0.3,+p.vaso||10);
    const D=+p.diametro>0?+p.diametro/100:Math.cbrt(4*V/1000/(0.9*Math.PI));
    const Apot=Math.PI*(D/2)**2;
    const tawL=0.25*V*Math.max(0.6,1-0.06*(nTot-1));
    return {sp,fa,membri:m,h,interno,vaso:true,V,D,Apot,chioma,area:Math.max(Apot,chioma),tawL,rawL:tawL*pMin,lPerMm:(kcA+0.15*Apot)*fl,pioggiaArea:Apot*0.8};
  }
  const area=+p.area>0?+p.area:chioma;
  const tawL=sp.radici*fa.radici*(p.colt==='rialzata'?0.8:1)*120*area;
  return {sp,fa,membri:m,h,interno,vaso:false,chioma,area,tawL,rawL:tawL*pMin,lPerMm:kcA/chioma*area*fl,pioggiaArea:area*0.85};
}
export const consumoL=(k,d)=> k.interno ? et0Casa(k.h)*k.lPerMm : (d.et0||0)*k.lPerMm;
const pioggiaL=(p,k,d)=> p.dove!=='aperto' ? 0 : Math.max(0,(d.rain||0)-1.5)*k.pioggiaArea;

export function pianoLocale(piante, past, fut, ultime){
  const out=[];
  for(const p of piante){
    const k=params(p);
    let dep=k.rawL*0.5;
    const last=ultime[p.id]||'';
    for(const d of past){ dep=Math.min(k.tawL,Math.max(0,dep+consumoL(k,d)-pioggiaL(p,k,d))); if(d.date===last) dep=0; }
    if(fut[0] && last===fut[0].date) dep=0;
    const giorni=[];
    fut.forEach((d,i)=>{
      const pl=pioggiaL(p,k,d);
      let end=Math.min(k.tawL,Math.max(0,dep+consumoL(k,d)-pl));
      const next=fut[i+1];
      let g;
      if(pl>=k.rawL*0.25&&pl>0.05&&end<k.rawL) g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:`la pioggia basta (~${fmt(Math.min(pl,k.tawL))} L utili)`};
      else if(end>=k.rawL){
        const nr=next?pioggiaL(p,k,next):0;
        if(next&&nr>=end*0.6&&(next.prob??0)>=60&&end<k.tawL*0.85) g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:`rinvia: pioggia prevista domani (${fmt(next.rain)} mm)`};
        else { const l=Math.max(0.05,end*(k.vaso?1.1:1)); g={data:d.date,azione:'innaffia',litri:+l.toFixed(l<2?2:1),momento:d.tmin<=2&&!k.interno?'metà giornata':'mattina presto',
          motivo:(k.vaso?`vaso asciutto al ${Math.round(end/k.tawL*100)}%, bagna finché esce dal foro`:`riserva consumata al ${Math.round(end/k.tawL*100)}%`)}; end=0; }
      } else if(end>=k.rawL*0.8) g={data:d.date,azione:'controlla',litri:0,momento:'indifferente',motivo:'tocca il terriccio: se è asciutto a 2–3 cm, innaffia'};
      else g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'terriccio ancora umido'};
      giorni.push(g); dep=end;
    });
    out.push({id:p.id,giorni,consigli:[]});
  }
  return out;
}
const fmt=(n,d=1)=>(Math.round(n*10**d)/10**d).toLocaleString('it-IT');
const escHtml=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

/* ---------- Meteo ---------- */
async function meteo(pos){
  const q=new URLSearchParams({latitude:pos.lat,longitude:pos.lon,timezone:'auto',past_days:'3',forecast_days:'7',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max'});
  const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q);
  if(!r.ok) throw new Error('Open-Meteo HTTP '+r.status+': '+await r.text());
  const j=await r.json(), d=j.daily;
  const days=d.time.map((t,i)=>({date:t,code:d.weather_code[i],tmax:d.temperature_2m_max[i],tmin:d.temperature_2m_min[i],
    rain:d.precipitation_sum[i]??0,prob:d.precipitation_probability_max[i],et0:d.et0_fao_evapotranspiration[i]??0,wind:d.wind_speed_10m_max[i]}));
  const oggi=new Intl.DateTimeFormat('en-CA',{timeZone:j.timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return {oggi,tz:j.timezone,past:days.filter(x=>x.date<oggi),fut:days.filter(x=>x.date>=oggi).slice(0,7)};
}

/* ---------- Claude (facoltativo) ---------- */
const SCHEMA={type:'object',additionalProperties:false,required:['avvisi','piante'],properties:{
  avvisi:{type:'array',items:{type:'string'}},
  piante:{type:'array',items:{type:'object',additionalProperties:false,required:['id','giorni','consigli'],properties:{
    id:{type:'string'},consigli:{type:'array',items:{type:'string'}},
    giorni:{type:'array',items:{type:'object',additionalProperties:false,required:['data','azione','litri','momento','motivo'],properties:{
      data:{type:'string',format:'date'},azione:{type:'string',enum:['innaffia','salta','controlla']},litri:{type:'number'},
      momento:{type:'string',enum:['mattina presto','sera','metà giornata','indifferente']},motivo:{type:'string'}}}}}}}}};
const SYSTEM=`Sei un agronomo esperto di irrigazione di orti, giardini e piante in vaso. Ricevi in JSON posizione, meteo (giorni passati e 7 di previsione con ET0 FAO-56), piante (specie, fase di crescita, per i vasi volume, diametro e altre piante nello stesso vaso, ore di luce diretta, ambiente aperto/riparato/interno, ultima innaffiatura, calcolo dell'app in litri) e una stima locale da bilancio idrico. Per ogni pianta o vaso decidi l'azione per ciascuno dei 7 giorni previsti (stesse date, in ordine): "innaffia" con i litri totali per la voce, "controlla" (verificare l'umidità con un dito) o "salta". Parti dalla stima locale e correggila con la tua conoscenza di specie, fase, stagione, clima locale, gelo, caldo e ristagni. Vasi piccoli si asciugano prima e non possono trattenere più della loro riserva; meno luce = meno consumo; in casa niente pioggia; con più piante nello stesso vaso il consumo si somma e decide la più delicata. "motivo" al massimo 12 parole; "consigli" da 0 a 2 brevi; "avvisi" solo per eventi meteo rilevanti. Usa gli id ricevuti. Scrivi in italiano.`;

async function pianoClaude(input){
  const model=process.env.CLAUDE_MODEL||'claude-opus-5-5';
  const body={model,max_tokens:16000,output_config:{effort:'medium',format:{type:'json_schema',schema:SCHEMA}},system:SYSTEM,
    messages:[{role:'user',content:JSON.stringify(input)}]};
  const headers={'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2026-10-21'};
  if(model==='claude-opus-5-5'||model==='claude-sonnet-5-5'){ headers['anthropic-beta']='server-side-fallback-2026-07-01'; body.fallbacks='default'; }
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers,body:JSON.stringify(body)});
  const j=await r.json().catch(()=>null);
  if(!r.ok) throw new Error('Claude HTTP '+r.status+': '+(j?.error?.message||''));
  if(j.stop_reason==='refusal'||j.stop_reason==='max_tokens') throw new Error('Claude stop_reason '+j.stop_reason);
  const t=(j.content||[]).filter(b=>b.type==='text').pop()?.text;
  return JSON.parse(t);
}

/* ---------- Telegram ---------- */
async function tg(method,payload){
  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload||{})});
  const j=await r.json().catch(()=>({}));
  if(!j.ok) throw new Error(`Telegram ${method}: ${j.description||r.status}`);
  return j.result;
}

/* ---------- Main ---------- */
async function main(){
  if(!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Manca il secret TELEGRAM_BOT_TOKEN (vedi giardino/LEGGIMI.md).');
  if(!process.env.TELEGRAM_CHAT_ID){
    const ups=await tg('getUpdates');
    const chats=[...new Map(ups.map(u=>u.message?.chat||u.my_chat_member?.chat).filter(Boolean).map(c=>[c.id,c])).values()];
    console.log(chats.length?'Chat trovate (copia l\'id nel secret TELEGRAM_CHAT_ID):\n'+chats.map(c=>`  ${c.id}  ${c.first_name||c.title||''} ${c.username?'@'+c.username:''}`).join('\n')
      :'Nessuna chat trovata: apri il bot su Telegram, premi Avvia e scrivigli un messaggio, poi riavvia il workflow.');
    throw new Error('Manca il secret TELEGRAM_CHAT_ID.');
  }
  const cfg=JSON.parse(await readFile(FILE_PIANTE,'utf8'));
  let stato={ultime:{}}; try{ stato=JSON.parse(await readFile(FILE_STATO,'utf8')); }catch{}
  const piante=(cfg.piante||[]).filter(p=>p&&p.id&&p.nome);
  if(!piante.length) throw new Error('piante.json non contiene piante.');
  const ultime={}; for(const p of piante){ ultime[p.id]=[p.ultima||'',stato.ultime?.[p.id]||''].sort().pop(); }

  const {oggi,past,fut}=await meteo(cfg.posizione);
  const base=pianoLocale(piante,past,fut,ultime);
  let piano=base, fonte='stima locale', avvisi=[];
  const minT=Math.min(...fut.map(d=>d.tmin)), maxT=Math.max(...fut.map(d=>d.tmax));
  if(minT<=1) avvisi.push(`Rischio gelo (minima ${fmt(minT)} °C): proteggi le piante sensibili.`);
  if(maxT>=33) avvisi.push(`Caldo intenso (massima ${fmt(maxT)} °C): innaffia all'alba.`);

  if(process.env.ANTHROPIC_API_KEY){
    try{
      const c=await pianoClaude({oggi,posizione:cfg.posizione,meteo_passato:past,meteo_previsto:fut,
        piante:piante.map(p=>{const k=params(p);return {id:p.id,nome:p.nome,specie:k.sp.nome,fase:k.fa.nome,num:p.num||1,coltivazione:p.colt,
          vaso:k.vaso?{volume_litri:k.V,diametro_cm:Math.round(k.D*100),superficie_terriccio_m2:+k.Apot.toFixed(3)}:null,
          altre_piante_nel_vaso:k.membri.slice(1).map(m=>({specie:(SPECIE[m.specie]||SPECIE.altro).nome,fase:(FASI[m.fase]||FASI.vegetativa).nome,num:m.num})),
          ore_luce_diretta:k.h,ambiente:p.dove,ultima:ultime[p.id]||'non indicata',note:p.note||'',
          calcolo:{acqua_disponibile_litri:+k.tawL.toFixed(2),soglia_innaffiatura_litri:+k.rawL.toFixed(2),consumo_oggi_litri:+consumoL(k,fut[0]||{}).toFixed(2)}};}),
        stima_locale:base.map(x=>({id:x.id,giorni:x.giorni.map(g=>({data:g.data,azione:g.azione,litri:g.litri}))}))});
      if(Array.isArray(c?.piante)&&c.piante.length){ piano=c.piante; avvisi=c.avvisi||[]; fonte='Claude'; }
    }catch(e){ console.warn('Claude non disponibile, uso la stima locale:',e.message); }
  }

  const d0=fut[0];
  const righe={innaffia:[],controlla:[]};
  for(const p of piante){
    const g=piano.find(x=>x.id===p.id)?.giorni.find(x=>x.data===oggi);
    if(!g) continue;
    if(g.azione==='innaffia'){ righe.innaffia.push(`• <b>${escHtml(p.nome)}</b>: ${fmt(g.litri,g.litri<2?2:1)} L, ${escHtml(g.momento)}\n   <i>${escHtml(g.motivo)}</i>`); stato.ultime={...stato.ultime,[p.id]:oggi}; }
    if(g.azione==='controlla') righe.controlla.push(`• <b>${escHtml(p.nome)}</b>: ${escHtml(g.motivo)}`);
  }
  const daFare=righe.innaffia.length+righe.controlla.length;
  const dataLunga=new Date(oggi+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
  console.log(`${oggi} ${cfg.posizione.nome}: ${righe.innaffia.length} da innaffiare, ${righe.controlla.length} da controllare (${fonte}).`);

  if(!daFare && process.env.INVIA_SEMPRE!=='true'){ console.log('Niente da fare oggi: nessun messaggio inviato.'); return; }

  let msg=`💧 <b>Giardino — ${escHtml(dataLunga)}</b>\n${escHtml(cfg.posizione.nome)} · ${WMO[d0.code]||''}, ${fmt(d0.tmin,0)}–${fmt(d0.tmax,0)} °C, pioggia ${fmt(d0.rain)} mm\n`;
  if(cfg.esempio) msg+=`\n<i>Configurazione di esempio: aggiorna giardino/piante.json con le tue piante.</i>\n`;
  if(righe.innaffia.length) msg+=`\n<b>Da innaffiare oggi</b>\n${righe.innaffia.join('\n')}\n`;
  if(righe.controlla.length) msg+=`\n<b>Da controllare</b>\n${righe.controlla.join('\n')}\n`;
  if(!daFare) msg+=`\nOggi non c'è niente da innaffiare.\n`;
  for(const a of avvisi.slice(0,3)) msg+=`\n⚠️ ${escHtml(a)}`;
  const prossime=fut.slice(1,4).map(d=>{
    const n=piante.filter(p=>piano.find(x=>x.id===p.id)?.giorni.find(g=>g.data===d.date&&g.azione==='innaffia')).length;
    const wd=new Date(d.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'short'});
    return `${wd} ${n?n+' 💧':'–'}`;
  }).join(' · ');
  msg+=`\n\nProssimi giorni: ${prossime}\n<i>Piano: ${fonte}</i>`;

  await tg('sendMessage',{chat_id:process.env.TELEGRAM_CHAT_ID,text:msg,parse_mode:'HTML',disable_web_page_preview:true});
  console.log('Messaggio inviato.');
  if(righe.innaffia.length) await writeFile(FILE_STATO,JSON.stringify(stato,null,2)+'\n');
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  main().catch(e=>{ console.error('Errore:',e.message); process.exit(1); });
}
