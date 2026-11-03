// Giardino — modello di irrigazione condiviso da app (artifact) e bot Telegram.
// Solo funzioni pure: nessun accesso a rete, file o pagina. Le date sono stringhe AAAA-MM-GG.
// build-app.mjs inserisce questo file nell'app togliendo le parole "export".

/* ---------------- Date ---------------- */
export function isoDate(d){ const z=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
export function addDays(iso,n){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return isoDate(d); }
export function giorniTra(a,b){ return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/864e5); }
const meseDi = iso => new Date(iso+'T12:00:00').getMonth();

/* ---------------- Specie ----------------
   kc: [iniziale, sviluppo, piena stagione, fine stagione, riposo] (FAO-56 semplificato)
   area: chioma tipica per pianta (m²); radici: profondità a pieno sviluppo (m); p: quota di riserva consumabile
   ann: ciclo annuale; ciclo: giorni dalla semina in cui finisce ogni fase
        [germinazione, piantina, vegetativa, fioritura, fruttificazione, maturazione] (null = fase assente)
   trap: età tipica della piantina al trapianto (giorni)
   cal: fase per mese (gen→dic) per le perenni: R riposo, V vegetativa, F fioritura, T fruttificazione, M maturazione
   gelo: minima (°C) sotto cui la pianta all'aperto soffre; conc: giorni tra concimazioni per fase; rinvaso: anni
   cat: gruppo nell'elenco dell'app (CATEGORIE); ico: emoji della scheda */
export const SPECIE = {
  // Orto
  pomodoro:{nome:'Pomodoro',cat:'orto',ico:'🍅',kc:[0.6,0.85,1.15,0.8,0.3],area:0.30,radici:0.6,p:0.40,ann:true,ciclo:[10,40,75,95,145,175],trap:40,gelo:5,conc:{V:21,F:14,T:14},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  zucchina:{nome:'Zucchina',cat:'orto',ico:'🥒',kc:[0.5,0.75,1.0,0.8,0.3],area:0.80,radici:0.6,p:0.50,ann:true,ciclo:[7,21,40,55,100,120],trap:21,gelo:5,conc:{V:21,F:14,T:14},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  cetriolo:{nome:'Cetriolo',cat:'orto',ico:'🥒',kc:[0.6,0.8,1.0,0.75,0.3],area:0.35,radici:0.7,p:0.50,ann:true,ciclo:[7,21,40,55,90,110],trap:21,gelo:6,conc:{V:21,F:14,T:14},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  melone:{nome:'Melone / anguria',cat:'orto',ico:'🍉',kc:[0.5,0.75,1.0,0.75,0.3],area:1.00,radici:0.8,p:0.40,ann:true,ciclo:[8,25,50,65,100,120],trap:25,gelo:7,conc:{V:21,F:14,T:14},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  peperone:{nome:'Peperone / peperoncino',cat:'orto',ico:'🌶️',kc:[0.6,0.8,1.05,0.9,0.3],area:0.20,radici:0.5,p:0.30,ann:true,ciclo:[12,50,85,105,155,185],trap:50,gelo:6,conc:{V:21,F:14,T:14},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  melanzana:{nome:'Melanzana',cat:'orto',ico:'🍆',kc:[0.6,0.8,1.05,0.9,0.3],area:0.30,radici:0.6,p:0.45,ann:true,ciclo:[12,50,90,110,160,190],trap:50,gelo:6,conc:{V:21,F:14,T:14},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  lattuga:{nome:'Lattuga / insalate',cat:'orto',ico:'🥬',kc:[0.7,0.85,1.0,0.95,0.3],area:0.06,radici:0.3,p:0.30,ann:true,ciclo:[7,25,50,null,null,75],trap:25,gelo:-2,conc:{V:21},concTipo:'concime azotato leggero',rinvaso:0},
  spinaci:{nome:'Spinaci / bietola / rucola',cat:'orto',ico:'🥬',kc:[0.7,0.85,1.0,0.95,0.3],area:0.04,radici:0.35,p:0.20,ann:true,ciclo:[8,25,55,null,null,80],trap:30,gelo:-6,conc:{V:21},concTipo:'concime azotato leggero',rinvaso:0},
  cavolo:{nome:'Cavolo / broccolo / cavolfiore',cat:'orto',ico:'🥦',kc:[0.7,0.85,1.05,0.95,0.3],area:0.25,radici:0.5,p:0.45,ann:true,ciclo:[7,35,100,null,null,150],trap:35,gelo:-6,conc:{V:21},concTipo:'concime azotato',rinvaso:0},
  fagiolo:{nome:'Fagiolo / fagiolino',cat:'orto',ico:'🌱',kc:[0.5,0.75,1.05,0.9,0.3],area:0.15,radici:0.5,p:0.45,ann:true,ciclo:[7,20,40,50,80,95],trap:0,gelo:4,conc:{},concTipo:'',rinvaso:0},
  pisello:{nome:'Pisello / fava',cat:'orto',ico:'🌱',kc:[0.5,0.75,1.15,1.05,0.3],area:0.06,radici:0.6,p:0.35,ann:true,ciclo:[10,30,55,70,95,115],trap:0,gelo:-5,conc:{},concTipo:'',rinvaso:0},
  patata:{nome:'Patata',cat:'orto',ico:'🥔',kc:[0.5,0.75,1.15,0.75,0.3],area:0.20,radici:0.5,p:0.35,ann:true,ciclo:[20,35,55,75,null,115],trap:0,gelo:0,conc:{V:30},concTipo:'concime per ortaggi ricco di potassio',rinvaso:0},
  carota:{nome:'Carota / rapa',cat:'orto',ico:'🥕',kc:[0.7,0.85,1.05,0.95,0.3],area:0.01,radici:0.4,p:0.35,ann:true,ciclo:[14,35,70,null,null,100],trap:0,gelo:-3,conc:{V:30},concTipo:'concime povero di azoto',rinvaso:0},
  ravanello:{nome:'Ravanello',cat:'orto',ico:'🌱',kc:[0.7,0.8,0.9,0.85,0.3],area:0.01,radici:0.2,p:0.30,ann:true,ciclo:[5,12,25,null,null,35],trap:0,gelo:-2,conc:{},concTipo:'',rinvaso:0},
  aglio:{nome:'Aglio',cat:'orto',ico:'🧄',kc:[0.7,0.85,1.0,0.7,0.3],area:0.02,radici:0.3,p:0.30,ann:true,ciclo:[25,80,170,null,220,250],trap:0,gelo:-10,conc:{V:45},concTipo:'poco concime, senza eccesso di azoto',rinvaso:0},
  cipolla:{nome:'Cipolla / porro / scalogno',cat:'orto',ico:'🧅',kc:[0.7,0.85,1.05,0.75,0.3],area:0.02,radici:0.3,p:0.30,ann:true,ciclo:[12,50,100,null,140,170],trap:50,gelo:-8,conc:{V:30},concTipo:'concime per ortaggi povero di azoto',rinvaso:0},
  // Aromatiche
  basilico:{nome:'Basilico',cat:'aromatiche',ico:'🌿',kc:[0.6,0.8,1.0,0.9,0.3],area:0.05,radici:0.25,p:0.30,ann:true,ciclo:[10,30,90,120,null,150],trap:30,gelo:8,conc:{V:21},concTipo:'concime liquido per aromatiche',rinvaso:0},
  prezzemolo:{nome:'Prezzemolo / erbe tenere',cat:'aromatiche',ico:'🌿',kc:[0.6,0.8,0.95,0.9,0.4],area:0.05,radici:0.3,p:0.35,ann:true,ciclo:[20,50,200,null,null,260],trap:40,gelo:-5,conc:{V:30},concTipo:'concime liquido per aromatiche',rinvaso:0},
  menta:{nome:'Menta / melissa',cat:'aromatiche',ico:'🌿',kc:[0.6,0.8,1.0,0.9,0.4],area:0.10,radici:0.3,p:0.40,cal:'RRVVVFFVVVRR',gelo:-10,conc:{V:30},concTipo:'concime liquido per aromatiche',rinvaso:1},
  rosmarino:{nome:'Rosmarino / salvia / timo',cat:'aromatiche',ico:'🌿',kc:[0.35,0.4,0.5,0.45,0.25],area:0.25,radici:0.6,p:0.65,cal:'RRFFVVVVVVRR',gelo:-8,conc:{V:60,F:60},concTipo:'poco concime organico',rinvaso:2},
  lavanda:{nome:'Lavanda',cat:'aromatiche',ico:'🌿',kc:[0.35,0.4,0.5,0.45,0.25],area:0.30,radici:0.6,p:0.65,cal:'RRVVVFFVVVRR',gelo:-10,conc:{V:60},concTipo:'poco concime organico',rinvaso:2},
  // Frutti
  fragola:{nome:'Fragola',cat:'frutti',ico:'🍓',kc:[0.4,0.6,0.85,0.75,0.3],area:0.08,radici:0.25,p:0.20,cal:'RRVFTTVVVVRR',gelo:-5,conc:{V:30,F:14,T:14},concTipo:'concime per piccoli frutti',rinvaso:2},
  agrumi:{nome:'Agrumi (limone, arancio…)',cat:'frutti',ico:'🍋',kc:[0.65,0.65,0.7,0.7,0.45],area:0.60,radici:0.8,p:0.50,cal:'RRVFFTTTTMMR',gelo:3,conc:{V:20,F:20,T:20},concTipo:'concime per agrumi',rinvaso:3},
  olivo:{nome:'Olivo',cat:'frutti',ico:'🫒',kc:[0.5,0.55,0.65,0.65,0.4],area:1.50,radici:1.0,p:0.65,cal:'RRVVFTTTTMMR',gelo:-5,conc:{V:45,F:45},concTipo:'concime organico',rinvaso:3},
  vite:{nome:'Vite / uva',cat:'frutti',ico:'🍇',kc:[0.3,0.5,0.7,0.45,0.2],area:1.50,radici:1.0,p:0.45,cal:'RRRVFTTTMVRR',gelo:-15,conc:{V:45},concTipo:'concime organico',rinvaso:3},
  fruttiferi:{nome:'Albero da frutto (melo, pesco…)',cat:'frutti',ico:'🍎',kc:[0.45,0.6,0.95,0.75,0.35],area:3.00,radici:1.2,p:0.50,cal:'RRFVVTTTMMRR',gelo:-15,conc:{V:45,F:45},concTipo:'concime per alberi da frutto',rinvaso:3},
  // Fiori, arbusti e prato
  rosa:{nome:'Rosa',cat:'fiori',ico:'🌹',kc:[0.6,0.75,0.9,0.8,0.35],area:0.35,radici:0.5,p:0.45,cal:'RRVVFFFVFVRR',gelo:-10,conc:{V:15,F:15},concTipo:'concime per rose',rinvaso:3},
  ortensia:{nome:'Ortensia',cat:'fiori',ico:'💠',kc:[0.7,0.9,1.1,0.9,0.35],area:0.50,radici:0.4,p:0.35,cal:'RRRVVFFFVVRR',gelo:-5,conc:{V:15,F:15},concTipo:'concime per acidofile',rinvaso:2},
  geranio:{nome:'Geranio / fiori da balcone',cat:'fiori',ico:'🌺',kc:[0.6,0.75,0.9,0.8,0.35],area:0.08,radici:0.25,p:0.40,cal:'RRVVFFFFFVRR',gelo:2,conc:{V:15,F:15},concTipo:'concime liquido per piante fiorite',rinvaso:1},
  arbusto:{nome:'Arbusto / siepe',cat:'fiori',ico:'🌳',kc:[0.5,0.6,0.7,0.6,0.35],area:0.60,radici:0.7,p:0.50,cal:'RRVVFFVVVVRR',gelo:-10,conc:{V:45,F:45},concTipo:'concime universale a lenta cessione',rinvaso:3},
  felce:{nome:'Felce',cat:'fiori',ico:'🌿',kc:[0.7,0.9,1.0,0.9,0.5],area:0.15,radici:0.25,p:0.30,cal:'RRVVVVVVVVRR',gelo:-5,conc:{V:30},concTipo:'concime liquido per piante verdi a metà dose',rinvaso:2},
  prato:{nome:'Prato (indica la superficie)',cat:'fiori',ico:'☘️',kc:[0.8,0.85,0.95,0.9,0.6],area:10,radici:0.2,p:0.40,cal:'RRVVVVVVVVRR',gelo:-15,conc:{V:60},concTipo:'concime per prato',rinvaso:0},
  // In casa
  appartamento:{nome:'Pianta da appartamento',cat:'casa',ico:'🪴',kc:[0.5,0.6,0.7,0.6,0.4],area:0.10,radici:0.3,p:0.50,cal:'RRVVVVVVVVRR',gelo:10,conc:{V:30},concTipo:'concime liquido per piante verdi',rinvaso:2},
  orchidea:{nome:'Orchidea',cat:'casa',ico:'🌸',kc:[0.3,0.4,0.45,0.4,0.3],area:0.05,radici:0.15,p:0.60,cal:'VFFFVVVVVVVV',gelo:12,conc:{V:14,F:21},concTipo:'concime per orchidee a metà dose',rinvaso:2},
  succulenta:{nome:'Succulenta / cactus',cat:'casa',ico:'🌵',kc:[0.25,0.3,0.35,0.3,0.1],area:0.04,radici:0.2,p:0.85,cal:'RRVVVVVVVVRR',gelo:3,conc:{V:30},concTipo:'concime per cactacee a metà dose',rinvaso:3},
  altro:{nome:'Altra pianta',cat:'altro',ico:'🌱',kc:[0.5,0.7,0.85,0.7,0.35],area:0.25,radici:0.5,p:0.50,cal:'RRVVFVVVVVRR',gelo:2,conc:{V:30,F:30},concTipo:'concime universale',rinvaso:2}
};
export const CATEGORIE = {orto:'Orto', aromatiche:'Aromatiche', frutti:'Frutti', fiori:'Fiori, arbusti e prato', casa:'In casa', altro:'Altro'};
export const FASI = {
  germinazione:{nome:'Semina / germinazione',kc:0,radici:0.25,p:0.20,l:'G'},
  piantina:{nome:'Piantina / trapianto',kc:0,radici:0.45,p:0.30,l:'P'},
  vegetativa:{nome:'Crescita vegetativa',kc:1,radici:0.8,p:null,l:'V'},
  fioritura:{nome:'Fioritura',kc:2,radici:1,p:null,l:'F'},
  fruttificazione:{nome:'Fruttificazione',kc:2,radici:1,p:null,l:'T'},
  maturazione:{nome:'Maturazione / raccolta',kc:3,radici:1,p:null,l:'M'},
  riposo:{nome:'Riposo vegetativo',kc:4,radici:1,p:null,l:'R'}
};
const DA_LETTERA = {G:'germinazione',P:'piantina',V:'vegetativa',F:'fioritura',T:'fruttificazione',M:'maturazione',R:'riposo'};
const ORDINE_FASI = ['germinazione','piantina','vegetativa','fioritura','fruttificazione','maturazione'];

/* ---------------- Fase di crescita (manuale o automatica) ---------------- */
export function faseEffettiva(p, oggi, lat){
  const sp=SPECIE[p.specie]||SPECIE.altro;
  if(p.fase!=='auto') return {fase:FASI[p.fase]?p.fase:'vegetativa', auto:false};
  if(sp.ann){
    if(!p.data_semina) return {fase:'vegetativa', auto:true, nota:'manca la data di semina o trapianto'};
    const eta=giorniTra(p.data_semina, oggi)+(p.tipo_data==='trapianto'?sp.trap:0);
    if(eta<0) return {fase:'germinazione', auto:true, eta, nota:'semina non ancora fatta'};
    for(let i=0;i<ORDINE_FASI.length;i++){ if(sp.ciclo[i]!=null && eta<sp.ciclo[i]) return {fase:ORDINE_FASI[i], auto:true, eta}; }
    return {fase:'maturazione', auto:true, eta, nota:'ciclo probabilmente concluso'};
  }
  let m=meseDi(oggi); if(lat!=null && lat<0) m=(m+6)%12;   // emisfero sud: stagioni invertite
  return {fase:DA_LETTERA[(sp.cal||SPECIE.altro.cal)[m]], auto:true};
}

/* ---------------- Luce, ambiente, evaporazione ---------------- */
const LUCE_DA_ESPO = {sole:8, mezzombra:4, ombra:2};
export function luceOre(p){ const h=Number(p.luce); return p.luce!=null && p.luce!=='' && isFinite(h) ? Math.max(0,Math.min(14,h)) : (LUCE_DA_ESPO[p.espo] ?? 6); }
export const fattoreLuce = h => 0.35 + 0.65*Math.min(h,9)/8;   // 0 h → 35%, 8 h → 100%, 9+ h → 108%
export const et0Casa = h => 0.8 + 0.15*Math.min(h,12);          // mm/giorno in casa, dipende dalla finestra

// ET0 di Hargreaves (FAO-56 eq. 52) da temperature e latitudine, corretta per nuvole e pioggia
export function et0Hargreaves(day, lat){
  if(day.tmax==null||day.tmin==null) return null;
  const d=new Date(day.date+'T12:00:00'); const J=Math.round((d-new Date(d.getFullYear(),0,0))/864e5);
  const phi=(lat??45)*Math.PI/180, dr=1+0.033*Math.cos(2*Math.PI*J/365), dec=0.409*Math.sin(2*Math.PI*J/365-1.39);
  const ws=Math.acos(Math.max(-1,Math.min(1,-Math.tan(phi)*Math.tan(dec))));
  const Ra=(24*60/Math.PI)*0.082*dr*(ws*Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.sin(ws));
  let et=0.0023*((day.tmax+day.tmin)/2+17.8)*Math.sqrt(Math.max(0,day.tmax-day.tmin))*Ra*0.408;
  if(day.cond==='pioggia'||day.cond==='temporale') et*=0.75; else if(day.cond==='nuvoloso'||day.cond==='nebbia') et*=0.85;
  return Math.max(0,+et.toFixed(2));
}

/* ---------------- Diario: innaffiature fatte e calibrazione ----------------
   evento = {id, plantId, tipo: 'fatto'|'saltato'|'umido'|'secco'|'concime'|'diagnosi'|'meno'|'piu', data, fonte, litri?}
   'secco' = era già asciutta (l'ho innaffiata); 'umido' = era ancora umida (non l'ho innaffiata).
   Gli eventi 'presunto' (il bot considera fatta un'innaffiatura senza risposta) valgono solo se quel giorno
   non c'è un evento esplicito per la stessa pianta. */
export function eventiValidi(eventi, plantId){
  const miei=(eventi||[]).filter(e=>e&&e.plantId===plantId&&e.data);
  const esplicito=new Set(miei.filter(e=>e.fonte!=='presunto').map(e=>e.data));
  return miei.filter(e=>e.fonte!=='presunto'||!esplicito.has(e.data));
}
export function dateInnaffiate(p, eventi){
  const s=new Set(eventiValidi(eventi,p.id).filter(e=>e.tipo==='fatto'||e.tipo==='secco').map(e=>e.data));
  if(p.ultima) s.add(p.ultima);
  return s;
}
export function ultimaInnaffiatura(p, eventi){ return [...dateInnaffiate(p,eventi)].sort().pop()||''; }
// Ogni "era ancora umida" toglie il 10% al consumo stimato, ogni "era già secca" aggiunge il 12% (ultimi 60 giorni).
export function calibrazione(eventi, plantId, oggi){
  let f=1;
  for(const e of eventiValidi(eventi,plantId)){
    if(giorniTra(e.data,oggi)>60||giorniTra(e.data,oggi)<0) continue;
    if(e.tipo==='umido'||e.tipo==='meno') f*=0.9; else if(e.tipo==='secco'||e.tipo==='piu') f*=1.12;   // meno/piu: correzioni dalla diagnosi da foto
  }
  return Math.max(0.5,Math.min(2,f));
}

/* ---------------- Parametri idrici di una pianta o di un vaso ---------------- */
export function membriVaso(p, faseMain){
  const main={specie:p.specie, fase:faseMain, num:Math.max(1,Math.round(+p.num||1))};
  const altri = p.colt==='vaso' && Array.isArray(p.consociate) ? p.consociate.filter(c=>c&&SPECIE[c.specie]).map(c=>({specie:c.specie, fase:FASI[c.fase]?c.fase:faseMain, num:Math.max(1,Math.round(+c.num||1))})) : [];
  return [main, ...altri];
}
// ctx = {oggi, lat, eventi, luce (sostituisce le ore di luce), estate (usa i Kc di piena stagione)}
export function params(p, ctx={}){
  const oggi=ctx.oggi||isoDate(new Date());
  const fe=faseEffettiva(p, oggi, ctx.lat);
  const sp=SPECIE[p.specie]||SPECIE.altro, fa=FASI[fe.fase];
  const membri=membriVaso(p, fe.fase), nTot=membri.reduce((a,m)=>a+m.num,0);
  const h=ctx.luce!=null?ctx.luce:luceOre(p), interno=p.dove==='interno', fl=interno?1:fattoreLuce(h);
  let kcA=0, chioma=0, pMin=1;
  for(const m of membri){
    const s=SPECIE[m.specie]||SPECIE.altro, f=FASI[m.fase]||FASI.vegetativa, a=s.area*m.num;
    kcA+=s.kc[ctx.estate?2:f.kc]*a; chioma+=a; pMin=Math.min(pMin, f.p??s.p);
  }
  if(+p.area>0){ kcA*=(+p.area)/chioma; chioma=+p.area; }
  const calib = ctx.eventi ? calibrazione(ctx.eventi, p.id, oggi) : 1;
  const base={sp,fa,fase:fe.fase,faseAuto:fe.auto,faseNota:fe.nota||'',membri,nTot,num:membri[0].num,h,fl,interno,calib};
  if(p.colt==='vaso'){
    const V=Math.max(0.3,+p.vaso||10);
    const D=+p.diametro>0 ? +p.diametro/100 : Math.cbrt(4*V/1000/(0.9*Math.PI));   // vaso alto ~0,9 × diametro
    const Apot=Math.PI*(D/2)**2;
    const tawL=0.25*V*Math.max(0.6,1-0.06*(nTot-1));                              // più radici, meno acqua trattenuta
    return {...base,vaso:true,V,D,Apot,chioma,area:Math.max(Apot,chioma),tawL,rawL:tawL*pMin,pMin,lPerMm:(kcA+0.15*Apot)*fl*calib,pioggiaArea:Apot*0.8};
  }
  const area=+p.area>0 ? +p.area : chioma;
  const tawL=sp.radici*fa.radici*(p.colt==='rialzata'?0.8:1)*120*area;            // 120 mm per metro di terreno medio
  return {...base,vaso:false,chioma,area,tawL,rawL:tawL*pMin,pMin,lPerMm:kcA/chioma*area*fl*calib,pioggiaArea:area*0.85};
}
export const consumoL = (k,d) => k.interno ? et0Casa(k.h)*k.lPerMm : (d?.et0||0)*k.lPerMm;
export const pioggiaL = (p,k,d) => p.dove!=='aperto' ? 0 : Math.max(0,(d?.rain||0)-1.5)*k.pioggiaArea;

/* ---------------- Piano locale (bilancio idrico giorno per giorno) ----------------
   opts = {piante, past, fut, eventi, oggi, lat, vacanza:{dal, al}}  (al = giorno del rientro) */
export function inVacanza(v, data){ return !!(v&&v.dal&&v.al&&data>=v.dal&&data<v.al); }
// Umidità del suolo (Open-Meteo, m³/m³, media 0–27 cm): per le piante in piena terra all'aperto sostituisce
// la stima dei giorni passati, se nessuno le ha innaffiate negli ultimi 3 giorni. Terreno medio: capacità di campo 0,32, appassimento 0,12.
const CAMPO=0.32, APPASS=0.12;
export function deficitDaSuolo(theta){ return Math.max(0,Math.min(1,(CAMPO-theta)/(CAMPO-APPASS))); }
export function pianoLocale({piante, past=[], fut=[], eventi=[], oggi, lat, vacanza, suolo=null}){
  const out={avvisi:[], piante:[]};
  if(!fut.length) return out;
  for(const p of piante){
    const k=params(p,{oggi,lat,eventi});
    const fatte=dateInnaffiate(p,eventi);
    let dep=k.rawL*0.5;
    const usaSuolo = suolo!=null && isFinite(suolo) && !k.vaso && p.dove==='aperto' && ![...fatte].some(d=>d>=addDays(oggi,-3));
    if(usaSuolo) dep=deficitDaSuolo(suolo)*k.tawL;
    else for(const d of past){ dep=Math.min(k.tawL,Math.max(0,dep+consumoL(k,d)-pioggiaL(p,k,d))); if(fatte.has(d.date)) dep=0; }
    if(fatte.has(oggi)) dep=0;
    const giorni=[];
    fut.forEach((d,i)=>{
      const pl=pioggiaL(p,k,d);
      let end=Math.min(k.tawL,Math.max(0,dep+consumoL(k,d)-pl));
      const next=fut[i+1], momento=d.tmin<=2&&!k.interno?'metà giornata':'mattina presto';
      const innaffia=(motivo,extra=1.1)=>{ const l=Math.max(0.05,end*(k.vaso?extra:1)); const g={data:d.date,azione:'innaffia',litri:+l.toFixed(l<2?2:1),momento,motivo}; end=0; return g; };
      let g;
      if(fatte.has(d.date) && d.date!==oggi){ g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Già innaffiata'}; end=0; }
      else if(vacanza && vacanza.dal===addDays(d.date,1) && end>k.tawL*0.15){ g=innaffia('Domani parti: bagna a fondo finché esce dal foro',1.15); }
      else if(inVacanza(vacanza,d.date)){
        if(end>=k.tawL*0.95) g=innaffia('Sei via: serve qualcuno che la bagni');
        else g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Sei via: la riserva basta ancora'};
      }
      else if(pl>=k.rawL*0.25 && pl>0.05 && end<k.rawL) g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'La pioggia basta (~'+fmtN(Math.min(pl,k.tawL))+' L utili)'};
      else if(end>=k.rawL){
        const nr=next?pioggiaL(p,k,next):0;
        if(next&&nr>=end*0.6&&(next.prob??0)>=60&&end<k.tawL*0.85) g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Rinvia: pioggia prevista domani ('+fmtN(next.rain)+' mm)'};
        else g=innaffia((k.vaso?'Vaso asciutto al ':'Riserva consumata al ')+Math.round(end/k.tawL*100)+'%'+(k.vaso?', bagna finché esce dal foro':''));
      }
      else if(end>=k.rawL*0.8) g={data:d.date,azione:'controlla',litri:0,momento:'indifferente',motivo:'Tocca il terriccio: se asciutto a 2–3 cm, innaffia'};
      else g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Terriccio ancora umido'};
      giorni.push(g); dep=end;
    });
    out.piante.push({id:p.id, valutazione:'', fabbisogno_settimanale_litri:+giorni.reduce((a,g)=>a+g.litri,0).toFixed(1), giorni, consigli:[]});
  }
  const minT=Math.min(...fut.map(d=>d.tmin)), maxT=Math.max(...fut.map(d=>d.tmax));
  const freddo=piante.filter(p=>p.dove!=='interno' && minT<=gelo(p));
  if(freddo.length) out.avvisi.push('Minima fino a '+fmtN(minT)+' °C: proteggi '+freddo.map(p=>p.nome).join(', ')+'.');
  if(maxT>=33) out.avvisi.push('Caldo intenso (fino a '+fmtN(maxT)+' °C): innaffia all\'alba e controlla i vasi piccoli anche la sera.');
  return out;
}
const fmtN=(n,d=1)=>(Math.round(n*10**d)/10**d).toLocaleString('it-IT');

/* ---------------- Dosi pratiche ---------------- */
const FRAZ={0.25:'¼',0.5:'½',0.75:'¾'};
export function dose(litri, imp={}){
  const b=+imp.bicchiere>0?+imp.bicchiere:0.25, a=+imp.annaffiatoio>0?+imp.annaffiatoio:5;
  if(!(litri>0)) return '';
  if(litri<0.1) return '≈ '+Math.max(1,Math.round(litri/0.015))+' cucchiai';
  if(litri<=Math.max(1.5,b*2)){ const n=Math.max(0.5,Math.round(litri/b*2)/2); return '≈ '+(n===0.5?'½':String(n).replace('.5','½'))+' '+(n<=1?'bicchiere':'bicchieri'); }
  const q=Math.max(0.25,Math.round(litri/a*4)/4), int=Math.floor(q), fr=FRAZ[+(q-int).toFixed(2)]||'';
  if(!int) return '≈ '+fr+' di annaffiatoio';
  return '≈ '+int+' '+(int>1?'annaffiatoi':'annaffiatoio')+(fr?' e '+fr:'');
}

/* ---------------- Gelo, caldo, vento ---------------- */
export function gelo(p){ const sp=SPECIE[p.specie]||SPECIE.altro; return sp.gelo+(p.colt==='vaso'?2:0); }   // le radici in vaso gelano prima
// notte (facoltativa) = temperature orarie dalla sera di oggi alla mattina di domani: [{ora:'HH', t}]
export function avvisiDomani(piante, domani, notte){
  if(!domani) return [];
  const out=[], fuori=piante.filter(p=>p.dove!=='interno');
  const oraria = Array.isArray(notte) && notte.length ? notte : null;
  const minima = oraria ? Math.min(...oraria.map(x=>x.t)) : domani.tmin;
  const fredde=fuori.filter(p=>minima<=gelo(p));
  if(fredde.length){
    let testo='Minima di '+fmtN(minima)+' °C';
    if(oraria){
      const soglia=Math.max(...fredde.map(gelo)), sotto=oraria.filter(x=>x.t<=soglia), piu=oraria.find(x=>x.t===minima);
      testo='Stanotte minima di '+fmtN(minima)+' °C verso le '+piu.ora+':00'+(sotto.length>1?' (sotto '+fmtN(soglia)+' °C dalle '+sotto[0].ora+':00 alle '+sotto[sotto.length-1].ora+':00)':'');
    }
    out.push({tipo:'gelo', testo:testo+': porta al riparo o copri con tessuto non tessuto '+fredde.map(p=>p.nome).join(', ')+'.', piante:fredde.map(p=>p.id)});
  }
  if(domani.tmax>=33){
    const delicate=fuori.filter(p=>(p.colt==='vaso'&&(+p.vaso||10)<=10&&luceOre(p)>=5)||['lattuga','fragola','ortensia','basilico'].includes(p.specie));
    if(delicate.length) out.push({tipo:'caldo', testo:'Massima di '+fmtN(domani.tmax)+' °C: bagna all\'alba e sposta all\'ombra nel pomeriggio '+delicate.map(p=>p.nome).join(', ')+'.', piante:delicate.map(p=>p.id)});
  }
  if((domani.wind||0)>=50){ const vasi=fuori.filter(p=>p.colt==='vaso'); if(vasi.length) out.push({tipo:'vento', testo:'Vento fino a '+Math.round(domani.wind)+' km/h: lega o avvicina al muro i vasi alti ('+vasi.map(p=>p.nome).join(', ')+').', piante:vasi.map(p=>p.id)}); }
  return out;
}

/* ---------------- Concimazione ---------------- */
export function concime(p, {oggi, lat, eventi}={}){
  oggi=oggi||isoDate(new Date());
  const sp=SPECIE[p.specie]||SPECIE.altro, fe=faseEffettiva(p,oggi,lat), freq=sp.conc[FASI[fe.fase].l];
  if(!freq) return {inStagione:false, testo:fe.fase==='riposo'?'Niente concime durante il riposo':'Non serve in questa fase'};
  const date=[...eventiValidi(eventi,p.id).filter(e=>e.tipo==='concime').map(e=>e.data), p.ultima_concime].filter(Boolean).sort();
  const ultima=date.pop()||'';
  const tra = ultima ? freq-giorniTra(ultima,oggi) : 0;
  return {inStagione:true, freq, ultima, tra, dovuto:tra<=0, tipo:sp.concTipo,
    testo: tra<=0 ? 'Da concimare ('+sp.concTipo+', ogni '+freq+' giorni)' : 'Prossima concimazione tra '+tra+' giorni'};
}

/* ---------------- Rinvaso ---------------- */
const MISURE=[1,2,3,5,7,10,12,15,20,25,30,40,50,70,100,150];
export function rinvaso(p, {oggi, lat}={}){
  oggi=oggi||isoDate(new Date());
  const out=[]; if(p.colt!=='vaso') return out;
  const sp=SPECIE[p.specie]||SPECIE.altro;
  const k=params(p,{oggi,lat,estate:true});
  if(!k.interno){
    const uso=5*k.lPerMm, giorni=k.rawL/uso;                   // estate: ET0 ~5 mm/giorno
    if(giorni<1){ const serve=k.V*1.5/giorni, nuovo=MISURE.find(m=>m>=serve)||Math.ceil(serve);
      out.push('In estate questo vaso si asciugherebbe in meno di un giorno: meglio un vaso da almeno '+nuovo+' L.'); }
  }
  if(p.data_rinvaso && sp.rinvaso>0){
    const anni=giorniTra(p.data_rinvaso,oggi)/365;
    if(anni>=sp.rinvaso){
      let m=meseDi(oggi); if(lat!=null&&lat<0) m=(m+6)%12;
      out.push(m>=1&&m<=3 ? 'È il momento di rinvasare: l\'ultimo rinvaso è di '+Math.floor(anni)+' anni fa.' : 'Da rinvasare la prossima primavera (ultimo rinvaso '+Math.floor(anni)+' anni fa).');
    }
  }
  return out;
}

/* ---------------- Vacanza: autonomia di ogni pianta ---------------- */
export function autonomia(p, {oggi, lat, eventi, fut=[]}={}){
  const k=params(p,{oggi,lat,eventi});
  const media = fut.length ? fut.reduce((a,d)=>a+consumoL(k,d),0)/fut.length : consumoL(k,{et0:3});
  const giorni = media>0 ? k.tawL/media : Infinity;
  const kOmbra=params(p,{oggi,lat,eventi,luce:Math.min(2,k.h)});
  const mediaOmbra = fut.length ? fut.reduce((a,d)=>a+consumoL(kOmbra,d),0)/fut.length : consumoL(kOmbra,{et0:3});
  return {giorni, giorniOmbra: mediaOmbra>0 ? kOmbra.tawL/mediaOmbra : Infinity, consumo:media, riserva:k.tawL, vaso:k.vaso};
}

/* ---------------- Dati orari di Open-Meteo: umidità del suolo adesso e temperature della notte ---------------- */
// h = risposta "hourly" con time, temperature_2m, soil_moisture_0_to_1cm, _1_to_3cm, _3_to_9cm, _9_to_27cm; ora = ora locale
export function datiOrari(h, oggi, ora){
  if(!h||!Array.isArray(h.time)) return {suolo:null, notte:null};
  const z=n=>String(n).padStart(2,'0'), i=h.time.indexOf(oggi+'T'+z(ora)+':00');
  const strati=[['soil_moisture_0_to_1cm',1],['soil_moisture_1_to_3cm',2],['soil_moisture_3_to_9cm',6],['soil_moisture_9_to_27cm',18]];
  let suolo=null;
  if(i>=0){ let s=0,w=0; for(const [k,p] of strati){ const v=h[k]?.[i]; if(v!=null&&isFinite(v)){ s+=v*p; w+=p; } } if(w) suolo=+(s/w).toFixed(3); }
  const da=oggi+'T18:00', a=addDays(oggi,1)+'T10:00';
  const notte=h.time.map((t,j)=>({t:h.temperature_2m?.[j],ora:t.slice(11,13),k:t})).filter(x=>x.k>=da&&x.k<=a&&x.t!=null).map(({ora,t})=>({ora,t}));
  return {suolo, notte:notte.length?notte:null};
}
export const ORARIO_PARAMS='temperature_2m,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,soil_moisture_9_to_27cm';
