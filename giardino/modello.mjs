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
   cat: gruppo (CATEGORIE); ico: emoji della scheda; fasiNomi: nomi delle fasi propri della specie (es. bulbo per aglio e cipolla) */
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
  aglio:{nome:'Aglio',cat:'orto',ico:'🧄',fasiNomi:{piantina:'Germoglio e prime foglie',fruttificazione:'Ingrossamento del bulbo'},kc:[0.7,0.85,1.0,0.7,0.3],area:0.02,radici:0.3,p:0.30,ann:true,ciclo:[25,80,170,null,220,250],trap:0,gelo:-10,conc:{V:45},concTipo:'poco concime, senza eccesso di azoto',rinvaso:0},
  cipolla:{nome:'Cipolla / porro / scalogno',cat:'orto',ico:'🧅',fasiNomi:{fruttificazione:'Ingrossamento del bulbo'},kc:[0.7,0.85,1.05,0.75,0.3],area:0.02,radici:0.3,p:0.30,ann:true,ciclo:[12,50,100,null,140,170],trap:50,gelo:-8,conc:{V:30},concTipo:'concime per ortaggi povero di azoto',rinvaso:0},
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
  nepenthes:{nome:'Nepenthes (carnivora tropicale)',cat:'casa',ico:'🪴',kc:[0.6,0.7,0.8,0.75,0.6],area:0.10,radici:0.2,p:0.25,cal:'VVVVVVVVVVVV',gelo:12,conc:{},concTipo:'',rinvaso:2,acquaDolce:true},
  carnivora:{nome:'Carnivora da torbiera (Dionaea, Sarracenia, Drosera)',cat:'fiori',ico:'🪴',kc:[0.7,0.9,1.0,0.9,0.4],area:0.05,radici:0.2,p:0.15,cal:'RRVVFVVVVVRR',gelo:-5,conc:{},concTipo:'',rinvaso:2,acquaDolce:true},
  tropicale:{nome:'Monstera / pothos / filodendro',cat:'casa',ico:'🪴',kc:[0.5,0.65,0.75,0.65,0.45],area:0.25,radici:0.3,p:0.50,cal:'RRVVVVVVVVRR',gelo:12,conc:{V:21},concTipo:'concime liquido per piante verdi',rinvaso:2},
  sansevieria:{nome:'Sansevieria / zamioculcas',cat:'casa',ico:'🪴',kc:[0.25,0.3,0.35,0.3,0.15],area:0.06,radici:0.25,p:0.80,cal:'RRVVVVVVVVRR',gelo:10,conc:{V:45},concTipo:'concime per piante verdi a metà dose',rinvaso:3},
  ficus:{nome:'Ficus (benjamin, elastica, lyrata)',cat:'casa',ico:'🌳',kc:[0.5,0.6,0.7,0.6,0.45],area:0.40,radici:0.4,p:0.50,cal:'RRVVVVVVVVRR',gelo:10,conc:{V:21},concTipo:'concime liquido per piante verdi',rinvaso:2},
  spatifillo:{nome:'Spatifillo / calathea / anthurium',cat:'casa',ico:'🌿',kc:[0.6,0.75,0.85,0.75,0.5],area:0.12,radici:0.25,p:0.35,cal:'RRVVFFVVVVRR',gelo:13,conc:{V:21,F:21},concTipo:'concime liquido per piante verdi a metà dose',rinvaso:2},
  oleandro:{nome:'Oleandro',cat:'fiori',ico:'🌺',kc:[0.5,0.6,0.75,0.65,0.3],area:0.60,radici:0.6,p:0.50,cal:'RRVVFFFFFVRR',gelo:-5,conc:{V:30,F:30},concTipo:'concime per piante fiorite',rinvaso:3},
  bulbose:{nome:'Bulbose da fiore (tulipano, narciso, giacinto)',cat:'fiori',ico:'🌷',kc:[0.5,0.7,0.9,0.6,0.1],area:0.02,radici:0.25,p:0.40,cal:'VVFFVRRRRVVV',gelo:-15,conc:{V:30,F:30},concTipo:'concime per bulbose, dopo la fioritura',rinvaso:0},
  altro:{nome:'Altra pianta',cat:'altro',ico:'🌱',kc:[0.5,0.7,0.85,0.7,0.35],area:0.25,radici:0.5,p:0.50,cal:'RRVVFVVVVVRR',gelo:2,conc:{V:30,F:30},concTipo:'concime universale',rinvaso:2}
};
// Nomi comuni e scientifici di ogni specie: per la ricerca nell'elenco e per riconoscere la specie dal nome della pianta.
export const ALIAS = {
  pomodoro:'pomodoro,pomodorino,ciliegino,datterino,san marzano,cuore di bue,solanum lycopersicum,tomato',
  zucchina:'zucchina,zucchino,zucca,cucurbita,courgette',cetriolo:'cetriolo,cucumis sativus',melone:'melone,anguria,cocomero,cucumis melo,citrullus',
  peperone:'peperone,peperoncino,capsicum,habanero,jalapeno,friggitello',melanzana:'melanzana,solanum melongena',
  lattuga:'lattuga,insalata,indivia,radicchio,scarola,songino,valerianella,cicoria,lactuca',spinaci:'spinaci,bietola,bieta,coste,rucola,spinacia',
  cavolo:'cavolo,broccolo,cavolfiore,verza,cavolo nero,cime di rapa,brassica,cavolini',fagiolo:'fagiolo,fagiolino,phaseolus',
  pisello:'pisello,fava,taccola,cece,lenticchia,pisum',patata:'patata,solanum tuberosum',carota:'carota,rapa,barbabietola,daucus',ravanello:'ravanello,raphanus',
  aglio:'aglio,allium sativum',cipolla:'cipolla,cipollotto,porro,scalogno,allium cepa',
  basilico:'basilico,ocimum',prezzemolo:'prezzemolo,erba cipollina,coriandolo,aneto,cerfoglio,petroselinum',menta:'menta,mentuccia,melissa,nepitella,mentha',
  rosmarino:'rosmarino,salvia,timo,origano,maggiorana,santoreggia,alloro,elicriso,salvia rosmarinus,erbe aromatiche,aromatiche',lavanda:'lavanda,lavandula',
  fragola:'fragola,fragolina,fragaria',agrumi:'limone,arancio,arancia,mandarino,clementina,kumquat,pompelmo,cedro,lime,agrume,citrus,calamondino',
  olivo:'olivo,ulivo,oliva,olea',vite:'vite,uva,vitis',fruttiferi:'melo,pero,pesco,albicocco,ciliegio,susino,prugno,fico,kaki,cachi,melograno,nocciolo,noce,mirtillo,lampone,mora,ribes,feijoa',
  rosa:'rosa,rose,roseto,rosaio',ortensia:'ortensia,hydrangea',geranio:'geranio,pelargonio,petunia,surfinia,begonia,impatiens,verbena,calibrachoa,gazania,dipladenia,mandevilla,viola,primula,ciclamino,fiori',
  arbusto:'arbusto,siepe,bosso,pittosporo,lauroceraso,gelsomino,photinia,edera,ligustro,bouganville,ibisco',felce:'felce,nephrolepis,capelvenere,adiantum,asplenium',prato:'prato,erba,tappeto erboso',
  appartamento:'pianta da appartamento,chlorophytum,clorofito,falangio,dracena,dracaena,kenzia,kentia,yucca,aspidistra,croton,dieffenbachia,aglaonema,pilea,peperomia,tradescantia,beaucarnea,schefflera,areca,chamaedorea',
  orchidea:'orchidea,phalaenopsis,falenopsis,dendrobium,cymbidium,oncidium,vanda',
  succulenta:'succulenta,grassa,cactus,cactacea,aloe,echeveria,crassula,haworthia,opuntia,sedum,euphorbia,kalanchoe,sempervivum,agave,mammillaria',
  nepenthes:'nepenthes,nepente,pianta carnivora tropicale',carnivora:'carnivora,dionaea,dionea,acchiappamosche,venere acchiappamosche,sarracenia,drosera,pinguicula,darlingtonia',
  tropicale:'monstera,pothos,potos,epipremnum,filodendro,philodendron,syngonium,alocasia,scindapsus,colocasia',
  sansevieria:'sansevieria,sanseveria,zamioculcas,dracaena trifasciata,lingua di suocera',ficus:'ficus,ficus benjamin,benjamina,ficus elastica,ficus lyrata,beniamino',
  spatifillo:'spatifillo,spathiphyllum,calathea,maranta,anthurium,anturio,ctenanthe,stromanthe',oleandro:'oleandro,nerium',
  bulbose:'tulipano,narciso,giacinto,crocus,croco,muscari,amaryllis,amarillide,bulbo,bulbi,iris,fresia,anemone'
};
const normNome = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
// Radice di una parola italiana: toglie la desinenza (singolare e plurale insieme) e uniforma ch/gh davanti a e/i.
const radiceIt = w => w.length<4 ? w : w.replace(/([cg])h(?=[ei])/g,'$1').replace(/(io|ia|ie|i|e|a|o)$/,'');
const radiciNome = s => normNome(s).split(' ').filter(Boolean).map(radiceIt);
let ALIAS_RADICI=null;   // [specie, radici della parola o frase, lunghezza] — calcolate una volta sola
// Specie più probabile dal nome scritto dall'utente («Nepenthes mirabilis» → nepenthes, «Pomodori ciliegini» → pomodoro).
// Confronta le radici delle parole: vince la corrispondenza più lunga («melone» batte «melo», «ficus» batte «fico»,
// «erba cipollina» batte «erba»); una parola uguale vale più di una con la stessa radice.
export function specieDaNome(nome){
  const parole=normNome(nome).split(' ').filter(Boolean), radici=parole.map(radiceIt);
  if(!parole.length) return null;
  ALIAS_RADICI ??= Object.entries(ALIAS).flatMap(([k,l])=>l.split(',').map(a=>[k, radiciNome(a), normNome(a)]).filter(x=>x[2]));
  const testo=' '+parole.join(' ')+' ';
  let best=null, punti=0;
  for(const [k,r,a] of ALIAS_RADICI){
    let v=0;
    if(testo.includes(' '+a+' ')) v=a.length+10;                                               // parola o frase identica
    else for(let i=0;i+r.length<=radici.length;i++) if(r.every((x,j)=>x===radici[i+j]) && r.join('').length>=3){ v=a.length+5; break; }   // stessa radice
    if(v>punti){ punti=v; best=k; }
  }
  return punti>=8 ? best : null;
}
/* ---------------- Schede dell'app (senza Claude) ----------------
   d: descrizione; luce, temp, terreno, acqua, umid: condizioni ideali; per: periodo (semina, trapianto, raccolta in Italia);
   cons: consigli; frutti: periodo dei frutti o del raccolto. Claude, se collegato, può scrivere una scheda più personale. */
export const INFO = {
  pomodoro:{d:'Ortaggio estivo che ama caldo e sole; in vaso serve un contenitore grande e un tutore.',luce:'Pieno sole, almeno 6–8 ore',temp:'Ideale 20–28 °C; sotto 10 °C si ferma, sopra 32 °C i fiori cadono',terreno:'Ricco, sciolto e drenante, con compost',acqua:'Regolare e abbondante con i frutti, al piede e mai sulle foglie',umid:'Media; con foglie bagnate arrivano peronospora e muffe',per:'Semina in semenzaio febbraio–marzo, trapianto aprile–maggio, raccolta luglio–settembre',cons:['Togli i germogli ascellari (femminelle) una volta a settimana.','Annaffiature irregolari spaccano i frutti e causano il marciume apicale.','Pacciama il vaso con paglia per tenere il terriccio fresco.'],frutti:'Luglio – settembre'},
  zucchina:{d:'Pianta vigorosa e generosa: una sola pianta occupa circa un metro quadro.',luce:'Pieno sole',temp:'Ideale 18–30 °C; teme il gelo e il freddo sotto 10 °C',terreno:'Molto ricco di sostanza organica, fresco',acqua:'Abbondante e costante, al piede, soprattutto con i frutti',umid:'Media; le foglie bagnate prendono l\'oidio (mal bianco)',per:'Semina aprile–maggio (anche diretta), raccolta giugno–settembre',cons:['Raccogli le zucchine a 15–20 cm: la pianta ne produce di più.','Se i frutti marciscono in punta servono più api: impollina a mano con un pennello.'],frutti:'Giugno – settembre'},
  cetriolo:{d:'Rampicante estivo che cresce in fretta e vuole acqua costante.',luce:'Pieno sole o leggera mezz\'ombra nelle ore calde',temp:'Ideale 20–28 °C; sotto 12 °C soffre',terreno:'Ricco, soffice e drenante',acqua:'Costante: con la siccità i frutti diventano amari',umid:'Medio-alta, ma foglie asciutte',per:'Semina aprile–maggio, raccolta giugno–agosto',cons:['Dagli una rete o un tutore su cui arrampicarsi.','Raccogli spesso i frutti ancora giovani.'],frutti:'Giugno – agosto'},
  melone:{d:'Ortaggio da frutto che ama il caldo e il terreno asciutto in superficie verso la maturazione.',luce:'Pieno sole',temp:'Ideale 22–30 °C; teme il freddo sotto 12 °C',terreno:'Ricco, caldo, ben drenato',acqua:'Regolare in crescita; riducila quando i frutti maturano per un sapore più dolce',umid:'Bassa-media',per:'Semina aprile–maggio, raccolta luglio–agosto',cons:['Metti una tavoletta sotto i frutti per non farli marcire.','Cima i rami dopo 4–5 foglie per avere più frutti.'],frutti:'Luglio – agosto'},
  peperone:{d:'Ortaggio lento a partire ma molto produttivo con il caldo; il peperoncino è ottimo in vaso.',luce:'Pieno sole',temp:'Ideale 20–30 °C; sotto 12 °C si blocca',terreno:'Ricco e ben drenato',acqua:'Regolare, senza ristagni; un po\' di stress rende i peperoncini più piccanti',umid:'Media',per:'Semina in semenzaio gennaio–marzo, trapianto maggio, raccolta luglio–ottobre',cons:['Usa un tutore: i rami carichi si spezzano.','Il peperoncino in vaso si può portare in casa d\'inverno e vive più anni.'],frutti:'Luglio – ottobre'},
  melanzana:{d:'Ortaggio da clima caldo, tra i più esigenti di calore.',luce:'Pieno sole',temp:'Ideale 22–30 °C; sotto 15 °C cresce poco',terreno:'Profondo, ricco e fresco',acqua:'Abbondante e regolare, soprattutto con i frutti',umid:'Media',per:'Semina in semenzaio febbraio–marzo, trapianto maggio, raccolta luglio–settembre',cons:['Tieni 5–6 frutti per pianta per averli più grandi.','Controlla le foglie: la dorifora e gli afidi la amano.'],frutti:'Luglio – settembre'},
  lattuga:{d:'Ortaggio da foglia a crescita rapida, adatto alle stagioni miti.',luce:'Sole in primavera e autunno, mezz\'ombra d\'estate',temp:'Ideale 12–20 °C; con il caldo va a seme e diventa amara',terreno:'Soffice, fresco, ricco',acqua:'Poca ma spesso: radici corte, il terriccio non deve seccare',umid:'Media',per:'Semina scalare da febbraio a ottobre, raccolta dopo 50–70 giorni',cons:['Semina poche piante ogni 2–3 settimane per averne sempre.','D\'estate ombreggia nelle ore calde.'],frutti:'Raccolta delle foglie da 6–8 settimane dopo la semina'},
  spinaci:{d:'Ortaggi da foglia rustici, ottimi per l\'autunno e l\'inverno.',luce:'Sole o mezz\'ombra',temp:'Ideale 10–20 °C; resistono al freddo, col caldo vanno a seme',terreno:'Ricco e fresco',acqua:'Regolare, terriccio sempre leggermente umido',umid:'Media',per:'Semina agosto–ottobre e febbraio–aprile, raccolta dopo 40–60 giorni',cons:['Raccogli le foglie esterne: la pianta continua a produrre.','La rucola d\'estate va all\'ombra.'],frutti:'Raccolta delle foglie da 5–8 settimane dopo la semina'},
  cavolo:{d:'Ortaggi autunnali e invernali, lenti ma resistenti al freddo.',luce:'Pieno sole',temp:'Ideale 15–20 °C; reggono il gelo leggero',terreno:'Ricco, profondo, ben concimato',acqua:'Regolare, soprattutto all\'inizio dopo il trapianto',umid:'Media',per:'Semina giugno–luglio, trapianto agosto–settembre, raccolta ottobre–febbraio',cons:['Proteggi con una rete dalla cavolaia (farfalla bianca).','Un po\' di freddo rende il sapore più dolce.'],frutti:'Ottobre – febbraio'},
  fagiolo:{d:'Legume facile, nano o rampicante; arricchisce il terreno di azoto.',luce:'Pieno sole',temp:'Ideale 18–28 °C; teme il freddo',terreno:'Sciolto, non troppo concimato',acqua:'Moderata; abbondante in fioritura e con i baccelli',umid:'Media',per:'Semina diretta aprile–luglio, raccolta dopo 60–90 giorni',cons:['Non serve concime: lo fa da solo con le radici.','Raccogli i fagiolini spesso, ancora teneri.'],frutti:'Giugno – settembre'},
  pisello:{d:'Legume da stagione fresca; seminato in autunno o a fine inverno.',luce:'Sole',temp:'Ideale 10–20 °C; il caldo blocca la produzione',terreno:'Sciolto e drenante',acqua:'Moderata, di più in fioritura',umid:'Media',per:'Semina ottobre–novembre o febbraio–marzo, raccolta aprile–giugno',cons:['Dai una rete o delle canne ai tipi rampicanti.','Non serve concime.'],frutti:'Aprile – giugno'},
  patata:{d:'Tubero facile anche in sacchi o vasi profondi.',luce:'Pieno sole',temp:'Ideale 15–22 °C; teme il gelo sulle foglie',terreno:'Sciolto, profondo, poco calcareo',acqua:'Regolare quando si formano i tuberi (dopo la fioritura); poi riduci',umid:'Media; foglie bagnate favoriscono la peronospora',per:'Messa a dimora marzo–aprile, raccolta giugno–luglio',cons:['Rincalza (aggiungi terra alla base) quando le piante sono alte 20 cm.','Raccogli quando le foglie ingialliscono.'],frutti:'Giugno – luglio'},
  carota:{d:'Radici da semina diretta: non sopportano il trapianto.',luce:'Sole',temp:'Ideale 15–22 °C',terreno:'Sabbioso, profondo, senza sassi',acqua:'Regolare: sbalzi di acqua spaccano le radici',umid:'Media',per:'Semina febbraio–luglio, raccolta dopo 80–110 giorni',cons:['Dirada le piantine a 4–5 cm.','Serve un vaso profondo almeno 25–30 cm.'],frutti:'Raccolta 3–4 mesi dopo la semina'},
  ravanello:{d:'L\'ortaggio più veloce: pronto in un mese.',luce:'Sole o mezz\'ombra',temp:'Ideale 10–20 °C',terreno:'Soffice e fresco',acqua:'Frequente e leggera: se secca diventa piccante e legnoso',umid:'Media',per:'Semina da febbraio a ottobre, raccolta dopo 25–35 giorni',cons:['Semina pochi semi ogni 10 giorni.','Va bene anche in un vaso basso.'],frutti:'Raccolta un mese dopo la semina'},
  aglio:{d:'Si pianta lo spicchio in autunno; il bulbo si forma in primavera e si raccoglie a inizio estate.',luce:'Pieno sole',temp:'Resiste al gelo; il freddo invernale serve a formare il bulbo',terreno:'Sciolto e ben drenante, senza letame fresco',acqua:'Poca: solo se il terriccio è asciutto; mai ristagni. Smetti 2–3 settimane prima della raccolta',umid:'Bassa',per:'Spicchi a dimora ottobre–dicembre, raccolta giugno–luglio',cons:['Pianta lo spicchio con la punta in su, 3–4 cm sotto terra.','Togli lo stelo dei fiori, se compare, per un bulbo più grande.','Raccogli quando metà delle foglie è secca.'],frutti:'Giugno – luglio'},
  cipolla:{d:'Bulbo da semina o da bulbilli; i porri restano in campo anche d\'inverno.',luce:'Pieno sole',temp:'Ideale 12–25 °C; resiste al freddo',terreno:'Sciolto e drenante',acqua:'Regolare in crescita, poca quando il bulbo matura',umid:'Bassa',per:'Bulbilli febbraio–marzo o settembre–ottobre, raccolta dopo 4–6 mesi',cons:['Smetti di bagnare quando le foglie si piegano.','Lascia asciugare i bulbi al sole qualche giorno.'],frutti:'Giugno – agosto'},
  basilico:{d:'Aromatica annuale che ama il caldo; si raccoglie per tutta l\'estate.',luce:'Sole, meglio non quello del primo pomeriggio d\'estate',temp:'Ideale 20–28 °C; sotto 10 °C annerisce',terreno:'Soffice e ricco',acqua:'Regolare: terriccio umido ma non fradicio; bagna al piede',umid:'Media',per:'Semina marzo–maggio, raccolta giugno–settembre',cons:['Cima le punte sopra una coppia di foglie: diventa più folto.','Togli i fiori, altrimenti le foglie perdono aroma.'],frutti:'Foglie da giugno a settembre'},
  prezzemolo:{d:'Aromatiche da foglia, facili in vaso.',luce:'Sole o mezz\'ombra',temp:'Ideale 10–25 °C; resiste al freddo',terreno:'Fresco e ricco',acqua:'Regolare, senza ristagni',umid:'Media',per:'Semina febbraio–settembre (germina lento, 3–4 settimane)',cons:['Taglia gli steli esterni alla base.','D\'estate sta meglio a mezz\'ombra.'],frutti:'Foglie quasi tutto l\'anno'},
  menta:{d:'Perenne invadente: meglio in un vaso tutto suo.',luce:'Mezz\'ombra o sole non torrido',temp:'Resiste al freddo; d\'inverno la parte aerea secca e riparte in primavera',terreno:'Fresco e ricco',acqua:'Ama il terriccio sempre umido',umid:'Media',cons:['Taglia spesso i rami: ricaccia più fitta.','Rinvasa o dividi il cespo ogni anno.'],frutti:'Foglie da aprile a ottobre'},
  rosmarino:{d:'Aromatiche mediterranee, perenni, che preferiscono il secco all\'umido.',luce:'Pieno sole',temp:'Resistono al freddo fino a circa −8 °C; temono il ristagno più del gelo',terreno:'Povero, sassoso e molto drenante',acqua:'Poca: solo quando il terriccio è asciutto in profondità',umid:'Bassa',cons:['Mai sottovaso pieno d\'acqua.','Pota leggermente dopo la fioritura.'],frutti:'Foglie tutto l\'anno'},
  lavanda:{d:'Arbusto mediterraneo da fiore, profumato e molto resistente alla siccità.',luce:'Pieno sole',temp:'Resiste al freddo; teme l\'umidità invernale',terreno:'Povero, calcareo e drenante',acqua:'Poca; ancora meno d\'inverno',umid:'Bassa',cons:['Pota dopo la fioritura senza tagliare nel legno vecchio.','In vaso usa terriccio con sabbia o pomice.'],frutti:'Fioritura giugno – luglio'},
  fragola:{d:'Perenne da frutto, ottima in vaso o in fioriera; produce per 2–3 anni.',luce:'Sole, almeno 6 ore',temp:'Resiste al freddo; i fiori temono le gelate tardive',terreno:'Leggermente acido, ricco e drenante',acqua:'Regolare, di più con i frutti; bagna senza bagnare i frutti',umid:'Media; frutti bagnati marciscono',cons:['Togli gli stoloni se vuoi più frutti.','Paglia sotto i frutti per tenerli puliti.'],frutti:'Maggio – giugno (rifiorenti fino all\'autunno)'},
  agrumi:{d:'Alberi sempreverdi da frutto; in vaso vivono decenni con le cure giuste.',luce:'Pieno sole',temp:'Temono il gelo: sotto 3 °C vanno riparati; ideale 15–30 °C',terreno:'Specifico per agrumi, leggermente acido e drenante',acqua:'Regolare d\'estate quando i primi cm sono asciutti; poca d\'inverno',umid:'Media',cons:['Foglie gialle con nervature verdi: manca ferro, usa un concime con microelementi.','D\'inverno in un locale luminoso e fresco (5–12 °C), non al caldo.'],frutti:'Fioritura in primavera, frutti da ottobre a marzo'},
  olivo:{d:'Albero mediterraneo molto resistente alla siccità.',luce:'Pieno sole',temp:'Resiste fino a circa −5/−8 °C; in vaso meno',terreno:'Drenante, anche povero',acqua:'Poca; di più in fioritura e in estate in vaso',umid:'Bassa',cons:['Il ristagno è il nemico principale.','Pota a fine inverno per aprire la chioma alla luce.'],frutti:'Olive da ottobre a dicembre'},
  vite:{d:'Rampicante da frutto, resistente e longeva.',luce:'Pieno sole',temp:'Resiste al freddo invernale; le gemme temono le gelate di aprile',terreno:'Drenante, anche povero',acqua:'Poca: solo con siccità prolungata, di più in vaso',umid:'Bassa; l\'umidità favorisce peronospora e oidio',cons:['Pota d\'inverno lasciando poche gemme per tralcio.','Sfoglia intorno ai grappoli a inizio estate.'],frutti:'Uva da agosto a ottobre'},
  fruttiferi:{d:'Alberi da frutto a foglia caduca; d\'inverno riposano.',luce:'Pieno sole',temp:'Resistono al freddo; i fiori temono le gelate tardive',terreno:'Profondo, fertile e drenante',acqua:'Regolare in primavera ed estate, soprattutto con i frutti',umid:'Media',cons:['Pota a fine inverno.','Dirada i frutti troppo fitti per averli più grandi.'],frutti:'Dalla tarda primavera all\'autunno, secondo la specie'},
  rosa:{d:'Arbusto da fiore che rifiorisce da maggio all\'autunno se curato.',luce:'Sole, almeno 5–6 ore',temp:'Resistente al freddo',terreno:'Ricco, profondo, ben drenato',acqua:'Regolare e profonda, al piede; mai sulle foglie',umid:'Media; foglie bagnate prendono ticchiolatura e oidio',cons:['Taglia i fiori appassiti sopra una foglia a cinque foglioline.','Pota a fine inverno.'],frutti:'Fioritura maggio – ottobre'},
  ortensia:{d:'Arbusto da fiore di mezz\'ombra, molto assetato d\'estate.',luce:'Mezz\'ombra, niente sole del pomeriggio',temp:'Resiste al freddo; soffre il caldo secco',terreno:'Acido, fresco e ricco',acqua:'Abbondante d\'estate; usa acqua piovana se l\'acqua di casa è calcarea',umid:'Medio-alta',cons:['Foglie afflosciate al pomeriggio: spesso è il caldo, controlla il terriccio prima di bagnare.','Il colore blu viene dal terreno acido.'],frutti:'Fioritura giugno – agosto'},
  geranio:{d:'Fiori da balcone generosi e facili.',luce:'Sole',temp:'Temono il gelo: d\'inverno al riparo sopra 2–5 °C',terreno:'Universale per fiorite, drenante',acqua:'Regolare d\'estate, quando i primi cm sono asciutti; quasi niente d\'inverno',umid:'Bassa-media',cons:['Togli i fiori secchi per una fioritura continua.','Controlla la farfallina del geranio (fori nei boccioli).'],frutti:'Fioritura aprile – ottobre'},
  arbusto:{d:'Arbusti e siepi da giardino o da grandi vasi.',luce:'Sole o mezz\'ombra, secondo la specie',temp:'In genere resistenti al freddo',terreno:'Universale, drenante',acqua:'Regolare il primo anno; poi solo con siccità (in vaso più spesso)',umid:'Media',cons:['Pota dopo la fioritura le specie da fiore, a fine inverno le altre.'],frutti:''},
  felce:{d:'Pianta verde da ombra che vuole umidità costante.',luce:'Ombra luminosa, niente sole diretto',temp:'Ideale 15–24 °C',terreno:'Soffice, ricco di torba o fibra',acqua:'Terriccio sempre leggermente umido, mai secco del tutto',umid:'Alta: nebulizza o usa un sottovaso con argilla espansa bagnata',cons:['Punte marroni: aria troppo secca.','Lontano dai termosifoni.'],frutti:''},
  prato:{d:'Tappeto erboso: l\'acqua si calcola sulla superficie.',luce:'Sole o mezz\'ombra secondo il miscuglio',temp:'Le graminacee comuni soffrono sopra 30 °C',terreno:'Drenante',acqua:'Poche volte e a fondo (radici profonde), la mattina presto',umid:'Media',cons:['Non tagliare troppo basso d\'estate (6–8 cm).'],frutti:''},
  appartamento:{d:'Piante verdi da interno, in genere facili; il pericolo più comune è troppa acqua.',luce:'Molta luce indiretta, vicino a una finestra',temp:'Ideale 18–24 °C; sotto 12 °C soffrono',terreno:'Universale per piante verdi, drenante',acqua:'Quando i primi 2–3 cm sono asciutti; d\'inverno meno',umid:'Media; d\'inverno il riscaldamento secca l\'aria',cons:['Svuota il sottovaso 15 minuti dopo aver bagnato.','Gira il vaso ogni tanto perché cresca dritta.'],frutti:''},
  orchidea:{d:'Epifita: le radici vivono all\'aria, nella corteccia, non in terra.',luce:'Luce intensa ma non sole diretto',temp:'Ideale 18–26 °C; un calo notturno di 5 °C in autunno aiuta a rifiorire',terreno:'Corteccia di pino, mai terriccio',acqua:'Ad immersione per 10 minuti quando le radici sono argentate; mai acqua nel cuore delle foglie',umid:'Alta',cons:['Radici verdi = bagnate, argentate = da bagnare.','Dopo la fioritura taglia lo stelo sopra il secondo nodo.'],frutti:'Fioritura in inverno e primavera'},
  succulenta:{d:'Piante che accumulano acqua nelle foglie o nel fusto: muoiono più spesso per troppa acqua che per siccità.',luce:'Molta luce, anche sole diretto (abituale piano piano)',temp:'Ideale 15–30 °C; d\'inverno fresche e asciutte',terreno:'Per cactacee, con sabbia o pomice',acqua:'Solo quando il terriccio è completamente asciutto; quasi niente d\'inverno',umid:'Bassa',cons:['Usa vasi con foro e niente sottovaso pieno.','Foglie molli e trasparenti: troppa acqua.'],frutti:''},
  nepenthes:{d:'Carnivora tropicale con le foglie ad ampolla; vive bene in casa con luce e umidità.',luce:'Molta luce indiretta, poche ore di sole tenue',temp:'Ideale 20–30 °C; sotto 12–15 °C soffre',terreno:'Sfagno, torba bionda e perlite; mai terriccio universale',acqua:'Terriccio sempre umido ma non fradicio, solo acqua piovana, distillata o di osmosi (niente calcare)',umid:'Alta (60% o più): senza umidità non fa nuove ampolle',cons:['Niente concime nel terriccio: brucia le radici.','Non riempire le ampolle e non nutrirla con carne.','Ampolle che seccano: aria troppo secca o poca luce.'],frutti:''},
  carnivora:{d:'Carnivore delle torbiere (Dionaea, Sarracenia, Drosera): d\'estate fuori al sole, d\'inverno riposano al freddo.',luce:'Pieno sole',temp:'D\'inverno serve il freddo (0–10 °C) per il riposo',terreno:'Torba bionda e perlite, senza concime',acqua:'Sottovaso con 1–2 cm d\'acqua piovana o distillata in estate; terriccio umido d\'inverno',umid:'Alta',cons:['Mai acqua del rubinetto né concime.','Non far scattare le trappole per gioco: la pianta si indebolisce.'],frutti:''},
  tropicale:{d:'Piante tropicali da foglia: crescono molto con luce e calore.',luce:'Molta luce indiretta; il sole diretto brucia le foglie',temp:'Ideale 18–27 °C; sotto 12 °C soffrono',terreno:'Drenante, con corteccia o perlite',acqua:'Quando i primi 3–5 cm sono asciutti',umid:'Medio-alta',cons:['Dai un tutore di cocco alla monstera.','Foglie gialle in basso: spesso troppa acqua.'],frutti:''},
  sansevieria:{d:'Le piante più resistenti alla siccità e alla poca luce.',luce:'Tollera l\'ombra; cresce meglio con molta luce',temp:'Ideale 18–27 °C; sotto 10 °C a rischio',terreno:'Per cactacee o universale con molta pomice',acqua:'Solo con terriccio del tutto asciutto: ogni 2–4 settimane d\'estate, ogni 1–2 mesi d\'inverno',umid:'Bassa',cons:['Foglie molli alla base: marciume da troppa acqua.'],frutti:''},
  ficus:{d:'Alberelli da interno che non amano gli spostamenti.',luce:'Molta luce, anche qualche ora di sole tenue',temp:'Ideale 18–25 °C; teme correnti fredde',terreno:'Universale drenante',acqua:'Quando i primi 3 cm sono asciutti',umid:'Media',cons:['Perde le foglie se lo sposti o con gli sbalzi di temperatura: poi le rifà.'],frutti:''},
  spatifillo:{d:'Piante da interno di sottobosco tropicale, amano l\'umidità.',luce:'Luce indiretta, anche poca',temp:'Ideale 18–27 °C; sotto 13 °C soffrono',terreno:'Soffice e ricco',acqua:'Terriccio sempre leggermente umido; lo spatifillo si affloscia quando ha sete',umid:'Alta: nebulizza, sottovaso con argilla bagnata',cons:['Calathea: meglio acqua piovana o lasciata riposare (teme calcare e cloro).','Punte secche: aria secca.'],frutti:''},
  oleandro:{d:'Arbusto mediterraneo da fiore, molto resistente (tutte le parti sono velenose).',luce:'Pieno sole',temp:'Resiste fino a circa −5 °C; in vaso proteggilo sotto zero',terreno:'Universale drenante',acqua:'Abbondante d\'estate in vaso, poca d\'inverno',umid:'Bassa',cons:['Pota dopo la fioritura.','Usa i guanti quando lo tagli.'],frutti:'Fioritura maggio – settembre'},
  bulbose:{d:'Bulbi piantati in autunno che fioriscono in primavera e poi riposano d\'estate.',luce:'Sole',temp:'Il freddo invernale serve alla fioritura',terreno:'Drenante: il bulbo marcisce nel bagnato',acqua:'Moderata da autunno a fioritura; niente acqua quando le foglie seccano',umid:'Bassa',cons:['Pianta i bulbi a una profondità pari a 2–3 volte la loro altezza.','Lascia seccare le foglie dopo la fioritura: nutrono il bulbo dell\'anno dopo.'],frutti:'Fioritura febbraio – aprile'},
  altro:{d:'Specie non nell\'elenco: l\'app usa valori medi. Se la riconosci, sceglila tra le specie per un calcolo più preciso.',luce:'Secondo la specie',temp:'Secondo la specie',terreno:'Universale drenante',acqua:'Quando i primi 2–3 cm di terriccio sono asciutti',umid:'Media',cons:['Segna «Terreno ancora umido» o «Era secca» quando capita: l\'app impara il consumo giusto.'],frutti:''}
};
const FASE_COSA={germinazione:'Terriccio sempre leggermente umido, mai fradicio, al caldo.',
  piantina:'Annaffiature leggere e frequenti; dopo il trapianto qualche giorno senza sole forte.',
  vegetativa:'Bagna a fondo quando i primi 2–3 cm sono asciutti; inizia il concime, se serve.',
  fioritura:'Acqua regolare: con la siccità i fiori cadono.',
  fruttificazione:'Il periodo in cui beve di più: regolarità, niente sbalzi.',
  maturazione:'Riduci un po\' l\'acqua: più sapore e meno marciumi.'};
const STAGIONI_MESI={inverno:[11,0,1],primavera:[2,3,4],estate:[5,6,7],autunno:[8,9,10]};
function testoConcime(sp){
  const c=sp.conc||{}, parti=[c.V&&'ogni '+c.V+' giorni in crescita', c.F&&'ogni '+c.F+' in fioritura', c.T&&'ogni '+c.T+' con i frutti'].filter(Boolean);
  if(!parti.length) return sp.acquaDolce ? 'Niente concime: le radici si bruciano' : 'Non serve';
  return sp.concTipo.charAt(0).toUpperCase()+sp.concTipo.slice(1)+', '+parti.join(', ');
}
// Consigli calcolati dai dati della pianta (vaso, luce, posto), oltre a quelli della specie.
export function consigliPianta(p){
  const sp=SPECIE[p.specie]||SPECIE.altro, out=[], h=luceOre(p), dentro=alCoperto(p);
  if(p.colt==='vaso' && (+p.vaso||10)<=3 && !dentro && h>=6) out.push('Vaso piccolo al sole: d\'estate può servire acqua anche due volte al giorno.');
  if(p.colt==='vaso' && p.materiale==='chiuso') out.push('Vaso senza fori: dai solo la dose indicata e, se prende la pioggia, svuota l\'acqua in più.');
  if(sp.cat==='casa' && !dentro && sp.gelo>=8) out.push('È una pianta da interno: all\'aperto solo d\'estate, in ombra luminosa, e dentro prima che la notte scenda sotto '+sp.gelo+' °C.');
  if(['orto','frutti'].includes(sp.cat) && h<4) out.push('Ha meno di 4 ore di sole: crescerà meno e farà pochi frutti.');
  if(p.dove==='interno' && ['orto','frutti','aromatiche'].includes(sp.cat)) out.push('In casa ha poca luce: tienila alla finestra più luminosa (meglio a sud).');
  return out;
}
// Scheda della pianta fatta dall'app con i dati della specie: stessa forma di quella scritta da Claude.
export function schedaAuto(p, lat){
  const k=SPECIE[p.specie]?p.specie:'altro', sp=SPECIE[k], I=INFO[k]||INFO.altro, dentro=alCoperto(p)||sp.cat==='casa';
  const out={auto:true, descrizione:I.d+(I.per?' '+I.per+'.':''), frutti:I.frutti||'',
    condizioni:{luce:I.luce, temperatura:I.temp, terreno:I.terreno, acqua:I.acqua, umidita:I.umid, concime:testoConcime(sp)},
    stagioni:{}, fasi:[], consigli:[...I.cons, ...consigliPianta(p)]};
  if(sp.ann){
    let da=0;
    ORDINE_FASI.forEach((f,i)=>{ const a=sp.ciclo[i]; if(a==null) return;
      const s1=Math.floor(da/7)+1, s2=Math.max(s1,Math.ceil(a/7)), bulbo=/bulbo/i.test(sp.fasiNomi?.[f]||'');
      out.fasi.push({quando:'settimane '+s1+(s2>s1?'–'+s2:''), fase:nomeFase(k,f), cosa:bulbo?'Acqua regolare senza ristagni; smetti 2–3 settimane prima della raccolta.':FASE_COSA[f]});
      da=a; });
    if(out.fasi.length) out.fasi[0].quando+=' dalla semina';
  } else {
    const cal=sp.cal||SPECIE.altro.cal, sud=lat!=null&&lat<0;
    const T={R:'riposo: acqua ridotta, solo con il terriccio asciutto, niente concime', V:'crescita: acqua regolare'+(sp.conc?.V?' e concime ogni '+sp.conc.V+' giorni':''),
      F:'fioritura: non far seccare il terriccio', T:'frutti: è quando beve di più', M:'maturazione e raccolta: un po\' meno acqua'};
    for(const [st,mesi] of Object.entries(STAGIONI_MESI)){
      const lettere=[...new Set(mesi.map(m=>cal[sud?(m+6)%12:m]))];
      let t=lettere.map(x=>T[x]).join('; '); t=t.charAt(0).toUpperCase()+t.slice(1)+'.';
      if(st==='inverno') t+= dentro ? ' Più luce possibile, lontano dai termosifoni.' : sp.gelo>=8 ? ' Teme il freddo: sotto '+sp.gelo+' °C va al riparo.' : sp.gelo>0 ? ' Sotto '+sp.gelo+' °C portala al riparo.' : ' Resiste fino a circa '+sp.gelo+' °C'+(p.colt==='vaso'?', in vaso un paio di gradi in meno':'')+'.';
      if(st==='estate') t+= dentro ? ' Niente sole diretto dietro i vetri.' : ' Con più di 30 °C bagna all\'alba e controlla i vasi piccoli anche la sera.';
      out.stagioni[st]=t;
    }
  }
  return out;
}
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
// nome della fase per una specie (aglio e cipolla: “Ingrossamento del bulbo” al posto di “Fruttificazione”)
export function nomeFase(specie, fase){ const sp=SPECIE[specie]||SPECIE.altro; return sp.fasiNomi?.[fase] || (FASI[fase]||FASI.vegetativa).nome; }
// specie in ordine alfabetico, “Altra pianta” in fondo
export function specieOrdinate(){ return Object.entries(SPECIE).sort(([a,x],[b,y])=>(a==='altro')-(b==='altro') || x.nome.localeCompare(y.nome,'it',{sensitivity:'base'})); }
// piante in ordine alfabetico, raggruppate per zona (prima quelle con una zona, in ordine alfabetico)
export const zonaDi = p => String(p?.zona||'').trim().replace(/\s+/g,' ');
export function pianteOrdinate(piante){
  const cmp=(a,b)=>a.localeCompare(b,'it',{sensitivity:'base',numeric:true});
  return [...(piante||[])].sort((a,b)=>{ const za=zonaDi(a), zb=zonaDi(b); return (!za)-(!zb) || cmp(za,zb) || cmp(String(a.nome||''),String(b.nome||'')); });
}
const DA_LETTERA = {G:'germinazione',P:'piantina',V:'vegetativa',F:'fioritura',T:'fruttificazione',M:'maturazione',R:'riposo'};
const ORDINE_FASI = ['germinazione','piantina','vegetativa','fioritura','fruttificazione','maturazione'];

/* ---------------- Gradi-giorno: le fasi delle annuali seguono le temperature vere ----------------
   I giorni del ciclo (SPECIE.ciclo) valgono per un anno tipico. Ogni giorno vero conta (T − base) / (riferimento − base)
   giorni «tipici» (da 0 a 1,6): col freddo la pianta cresce più piano, col caldo più in fretta. T = media del giorno:
   misurata (storico di Open-Meteo dalla semina), prevista (prossimi giorni), poi la stessa settimana dell'anno scorso
   e, se manca anche quella, una stima dal clima della latitudine. In casa e in veranda, la temperatura per stagione.
   GRADI[specie] = [base, riferimento] in °C (riferimento ≈ media tipica durante il ciclo). Senza dati del meteo: giorni. */
export const GRADI = {pomodoro:[10,21], zucchina:[10,21], cetriolo:[10,21], melone:[12,23], peperone:[10,21], melanzana:[12,22], lattuga:[4,14],
  spinaci:[2,12], cavolo:[4,15], fagiolo:[10,20], pisello:[4,12], patata:[6,15], carota:[3,14], ravanello:[4,13], aglio:[0,10], cipolla:[4,13],
  basilico:[10,21], prezzemolo:[4,14]};
const CLIMA=new Map(), ETA_CACHE=new Map(), kLat=lat=>lat==null?'x':(+lat).toFixed(2);
// L'app e il server registrano qui il meteo della posizione (storico + previsioni): lo usano le fasi automatiche.
export function registraClima(lat, c){ if(!c) return; CLIMA.set(kLat(lat), c); ETA_CACHE.clear(); }
export function climaDa(met){
  if(!met || !met.storico) return null;
  const prev={}; for(const d of met.days||[]) if(d.tmax!=null && d.tmin!=null) prev[d.date]=(d.tmax+d.tmin)/2;
  return {storico:met.storico, prev};
}
export function tempMedia(c, iso, lat){
  if(c){
    const v=c.prev[iso]??c.storico[iso]; if(v!=null) return v;
    let s=0,n=0; for(let k=-7;k<=7;k++){ const x=c.storico[addDays(iso,k-365)]; if(x!=null){ s+=x; n++; } }   // stessa settimana, un anno fa
    if(n>=5) return s/n;
  }
  const L=Math.abs(lat??44), doy=Math.round((Date.parse(iso+'T12:00:00Z')-Date.UTC(+iso.slice(0,4),0,0))/864e5);
  return 27.5-0.31*L - (4+0.15*L)*Math.cos(2*Math.PI*(doy-15-(lat<0?182:0))/365);
}
// giorni «tipici» di crescita dalla semina (o dal trapianto, più l'età della piantina) a «giorno»
export function etaEquivalente(p, giorno, lat){
  const sp=SPECIE[p.specie]||SPECIE.altro, g=GRADI[p.specie], c=CLIMA.get(kLat(lat)), tr=p.tipo_data==='trapianto'?sp.trap:0;
  const reali=giorniTra(p.data_semina, giorno);
  if(!g || !c || reali<=0) return {eta:reali+tr, reali};
  const k=[p.specie,p.data_semina,p.tipo_data,p.dove,JSON.stringify(p.tcasa||''),giorno,kLat(lat)].join('|');
  if(ETA_CACHE.has(k)) return ETA_CACHE.get(k);
  const [tb,tref]=g, casa=alCoperto(p), tc=casa?tempCasa(p):null;
  let eq=tr, d=p.data_semina;
  for(let i=0;i<Math.min(reali,600);i++){ const T=casa?tempCasaGiorno(tc,d,lat):tempMedia(c,d,lat); eq+=Math.max(0,Math.min(1.6,(T-tb)/(tref-tb))); d=addDays(d,1); }
  const r={eta:+eq.toFixed(1), reali, ritmo:+((eq-tr)/reali).toFixed(2)};
  if(ETA_CACHE.size>3000) ETA_CACHE.clear(); ETA_CACHE.set(k,r); return r;
}
export const urlStorico = (lat, lon, oggi) => 'https://historical-forecast-api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:lat, longitude:lon, timezone:'auto',
  start_date:addDays(oggi,-400), end_date:addDays(oggi,-1), daily:'temperature_2m_mean'});
export function storicoDa(j){ const d=j?.daily, o={}; if(d?.time) d.time.forEach((t,i)=>{ const v=d.temperature_2m_mean?.[i]; if(v!=null&&isFinite(v)) o[t]=v; }); return o; }

/* Raccolta prevista (p.raccolta = AAAA-MM, scritta dall'utente o da Claude nella scheda): le fasi automatiche si
   allungano o si accorciano in proporzione perché la maturazione cominci a metà di quel mese. */
export const inizioRaccolta = sp => sp.ciclo.slice(0,5).filter(x=>x!=null).pop();
// la raccolta prevista: quella scritta, altrimenti il primo mese di raccolta della scheda di Claude (se è per questa semina)
export function raccoltaDi(p){
  if(/^\d{4}-\d{2}$/.test(p?.raccolta||'')) return p.raccolta;
  const sc=p?.scheda; if(!sc || sc.specie!==p.specie || (sc.data_semina||'')!==(p.data_semina||'') || !p.data_semina) return '';
  return (sc.calendario||[]).filter(x=>x.raccolta && /^\d{4}-\d{2}$/.test(x.mese) && x.mese>p.data_semina.slice(0,7)).map(x=>x.mese).sort()[0]||'';
}
export function etaPianta(p, giorno, lat){
  const sp=SPECIE[p.specie]||SPECIE.altro, e=etaEquivalente(p, giorno, lat), r=raccoltaDi(p);
  if(!sp.ann || !r || !p.data_semina) return e;
  const rif=etaEquivalente(p, r+'-15', lat).eta, obiettivo=inizioRaccolta(sp);
  if(!(rif>0) || !obiettivo) return e;
  const f=Math.max(0.3,Math.min(3,obiettivo/rif));
  return {...e, eta:+(e.eta*f).toFixed(1), ritmo:e.ritmo!=null?+(e.ritmo*f).toFixed(2):+f.toFixed(2), raccolta:true};
}

/* ---------------- Fase di crescita (manuale o automatica) ---------------- */
export function faseEffettiva(p, oggi, lat){
  const sp=SPECIE[p.specie]||SPECIE.altro;
  if(p.fase!=='auto') return {fase:FASI[p.fase]?p.fase:'vegetativa', auto:false};
  if(sp.ann){
    if(!p.data_semina) return {fase:'vegetativa', auto:true, nota:'manca la data di semina o trapianto'};
    const {eta, ritmo}=etaPianta(p, oggi, lat);
    if(eta<0) return {fase:'germinazione', auto:true, eta, nota:'semina non ancora fatta'};
    for(let i=0;i<ORDINE_FASI.length;i++){ if(sp.ciclo[i]!=null && eta<sp.ciclo[i]) return {fase:ORDINE_FASI[i], auto:true, eta, ritmo}; }
    return {fase:'maturazione', auto:true, eta, ritmo, nota:'ciclo probabilmente concluso'};
  }
  let m=meseDi(oggi); if(lat!=null && lat<0) m=(m+6)%12;   // emisfero sud: stagioni invertite
  return {fase:DA_LETTERA[(sp.cal||SPECIE.altro.cal)[m]], auto:true};
}

/* ---------------- Luce, ambiente, evaporazione ---------------- */
const LUCE_DA_ESPO = {sole:8, mezzombra:4, ombra:2};
/* Sole diretto secondo la stagione. Con l'orientamento (verso dove guarda il balcone o la finestra) le ore di sole
   scritte dall'utente valgono per il giorno in cui le ha scritte (luce_data); negli altri giorni si scalano con la
   geometria del sole: ore in cui il sole è alto almeno 8° e davanti alla parete (entro 85° dalla sua direzione).
   «aperto» = nessuna parete (orto, giardino): conta tutto il giorno. Senza orientamento resta il numero fisso. */
export const ORIENTAMENTI = {N:0, NE:45, E:90, SE:135, S:180, SO:225, O:270, NO:315, aperto:null};
const SOLE_CACHE = new Map();
export function oreSoleGeom(iso, orient, lat){
  const k=iso+'|'+orient+'|'+Math.round((lat??44)*10);
  if(SOLE_CACHE.has(k)) return SOLE_CACHE.get(k);
  const r=Math.PI/180, phi=(lat??44)*r, n=Math.round((Date.parse(iso+'T12:00:00Z')-Date.UTC(+iso.slice(0,4),0,0))/864e5);
  const dec=23.44*r*Math.sin(2*Math.PI*(284+n)/365), A=ORIENTAMENTI[orient];
  let min=0;
  for(let m=0;m<1440;m+=5){
    const w=(m/60-12)*15*r, se=Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(w);
    if(se<Math.sin(8*r)) continue;
    if(A!=null && A!==undefined){
      const el=Math.asin(se), ca=(Math.sin(dec)-Math.sin(el)*Math.sin(phi))/(Math.cos(el)*Math.cos(phi));
      let az=Math.acos(Math.max(-1,Math.min(1,ca)))/r; if(w>0) az=360-az;          // azimut da nord, in senso orario
      const diff=Math.abs(((az-A+540)%360)-180); if(diff>85) continue;
    }
    min+=5;
  }
  const h=+(min/60).toFixed(2); if(SOLE_CACHE.size>2000) SOLE_CACHE.clear(); SOLE_CACHE.set(k,h); return h;
}
export function luceOre(p, oggi, lat){
  const v=Number(p.luce), h=p.luce!=null && p.luce!=='' && isFinite(v) ? Math.max(0,Math.min(14,v)) : (LUCE_DA_ESPO[p.espo] ?? 6);
  if(!oggi || !p.orient || !(p.orient in ORIENTAMENTI) || !/^\d{4}-\d{2}-\d{2}$/.test(p.luce_data||'') || p.luce_data===oggi) return h;
  const g0=oreSoleGeom(p.luce_data,p.orient,lat), g=oreSoleGeom(oggi,p.orient,lat), max=oreSoleGeom(oggi,'aperto',lat);
  // in proporzione; se quel giorno il sole geometrico era quasi nullo (parete a nord d'inverno), si aggiunge la differenza
  const x = g0>=1.5 ? h*g/g0 : h+0.7*(g-g0);
  return +Math.max(0,Math.min(14,max,x)).toFixed(1);
}
// Nuvole: in casa e in veranda la parte di consumo dovuta alla luce segue il sole previsto del giorno
// (d.sole = ore di sole / ore di luce, da Open-Meteo); con il cielo coperto resta la luce diffusa (35%).
export const fattoreNuvole = d => d?.sole==null || !isFinite(d.sole) ? 1 : 0.35+0.65*Math.min(1, Math.max(0,d.sole)/0.85);
export const fattoreLuce = h => 0.35 + 0.65*Math.min(h,9)/8;   // 0 h → 35%, 8 h → 100%, 9+ h → 108%
// In casa (mm/giorno): una parte viene dalla luce della finestra, una dall'aria. Più la stanza è calda, più l'aria
// “tira” acqua (deficit di vapore, proporzionale alla pressione di saturazione) e più la luce fa traspirare
// (fattore di Priestley-Taylor). A 20 °C vale come prima: 0,8 + 0,15 × ore di luce.
const esat = T => 0.6108*Math.exp(17.27*T/(T+237.3));                 // kPa
const ptay = T => { const D=4098*esat(T)/(T+237.3)**2; return D/(D+0.066); };
// In veranda o serra la luce arriva dal tetto e dalle vetrate: la parte dovuta al sole conta il doppio che a una finestra di casa.
export const et0Casa = (h, T=20, serra=false) => 0.8*esat(T)/esat(20) + (serra?0.30:0.15)*Math.min(h,12)*ptay(T)/ptay(20);
// al coperto (casa, veranda, serra): niente pioggia, temperatura scelta dall'utente
export const alCoperto = p => p?.dove==='interno' || p?.dove==='serra';

/* ---------------- Temperatura in casa per stagione ---------------- */
// valori tipici se l'utente non li indica: riscaldamento d'inverno, caldo d'estate
export const STAGIONI = ['inverno','primavera','estate','autunno'];
export const TCASA_DEF = {inverno:20, primavera:21, estate:26, autunno:21};
export const TSERRA_DEF = {inverno:10, primavera:20, estate:32, autunno:17};   // veranda o serra non riscaldata
export const tcasaValida = v => { const n=Number(v); return v!=null && v!=='' && isFinite(n) && n>=5 && n<=35 ? n : null; };
// temperature della stanza di una pianta, con i valori tipici al posto di quelli mancanti
export function tempCasa(p){ const t=p?.tcasa||{}, def=p?.dove==='serra'?TSERRA_DEF:TCASA_DEF; return Object.fromEntries(STAGIONI.map(s=>[s, tcasaValida(t[s]) ?? def[s]])); }
// temperatura di un giorno: passa gradualmente da una stagione all'altra (metà gennaio, aprile, luglio, ottobre);
// nell'emisfero sud le stagioni sono spostate di sei mesi
export function tempCasaGiorno(tc, iso, lat){
  const d=new Date(iso+'T12:00:00'); let g=Math.floor((d-new Date(d.getFullYear(),0,0))/864e5);
  if(lat!=null && lat<0) g=(g+183)%365||365;
  if(g<15) g+=365;
  const P=[[15,tc.inverno],[105,tc.primavera],[196,tc.estate],[288,tc.autunno],[380,tc.inverno]];
  for(let i=0;i<P.length-1;i++){ const [a,ta]=P[i], [b,tb]=P[i+1]; if(g>=a && g<=b) return ta+(tb-ta)*(g-a)/(b-a); }
  return tc.inverno;
}

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
// La stessa risposta più volte di fila corregge di più: 1ª volta −10% / +12%, 2ª −15% / +18%, dalla 3ª −20% / +24%.
// Una risposta opposta riparte da capo. meno/piu = correzioni dalla diagnosi da foto.
export function calibrazione(eventi, plantId, oggi){
  let f=1, verso=0, serie=0;
  const ev=eventiValidi(eventi,plantId).filter(e=>{ const g=giorniTra(e.data,oggi); return g>=0&&g<=60; }).sort((a,b)=>a.data<b.data?-1:a.data>b.data?1:0);
  for(const e of ev){
    const v=(e.tipo==='umido'||e.tipo==='meno'||(e.tipo==='verifica'&&e.valutazione==='meno'))?-1:(e.tipo==='secco'||e.tipo==='piu'||(e.tipo==='verifica'&&e.valutazione==='piu'))?1:0;
    if(!v) continue;
    serie = v===verso ? serie+1 : 1; verso=v;
    const passo=1+0.5*Math.min(serie-1,2);
    f *= v<0 ? 1-0.10*passo : 1+0.12*passo;
  }
  return Math.max(0.4,Math.min(2.5,f));
}

/* ---------------- Controllo della settimana (con il dito) ----------------
   Il sabato e la domenica, se nei 7 giorni prima non c'è stato un controllo, l'app chiede di toccare il terriccio
   (2–3 cm) della pianta di cui ha meno risposte recenti. La risposta si confronta con l'acqua che il calcolo dà nel
   terriccio: «asciutto» quando il calcolo ne vede ancora molta → beve di più; «umido» quando il calcolo la dà sotto la
   tacca → beve di meno; altrimenti il calcolo è giusto e non cambia niente. */
const RISPOSTE=['fatto','secco','umido','saltato','meno','piu','verifica'];
export function verificaDaFare(piante, eventi, oggi, vacanza){
  const g=new Date(oggi+'T12:00:00Z').getUTCDay();
  if((g!==6 && g!==0) || !piante?.length || inVacanza(vacanza, oggi)) return null;
  if((eventi||[]).some(e=>e.tipo==='verifica' && giorniTra(e.data,oggi)>=0 && giorniTra(e.data,oggi)<7)) return null;
  const ultima=p=>eventiValidi(eventi,p.id).filter(e=>['umido','secco','meno','piu','verifica'].includes(e.tipo)).map(e=>e.data).sort().pop()||'';
  return [...pianteOrdinate(piante)].sort((a,b)=>ultima(a)<ultima(b)?-1:ultima(a)>ultima(b)?1:0)[0];
}
// risposta = 'umido' | 'secco'; acqua e soglia = frazione della riserva (dal calcolo, a fine giornata)
export function esitoVerifica(risposta, acqua, soglia){
  if(acqua==null || soglia==null) return 'ok';
  if(risposta==='secco' && acqua>soglia+0.15) return 'piu';
  if(risposta==='umido' && acqua<soglia) return 'meno';
  return 'ok';
}
export const TESTO_VERIFICA = {ok:'Il calcolo era giusto: non cambia niente.', piu:'Il calcolo pensava che ci fosse più acqua: da ora conto che beve di più.', meno:'Il calcolo la dava già asciutta: da ora conto che beve di meno.'};

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
  const h=ctx.luce!=null?ctx.luce:luceOre(p, ctx.oggi, ctx.lat), interno=alCoperto(p), serra=p.dove==='serra', fl=interno?1:fattoreLuce(h);
  let kcA=0, chioma=0, pMin=1;
  for(const m of membri){
    const s=SPECIE[m.specie]||SPECIE.altro, f=FASI[m.fase]||FASI.vegetativa, a=s.area*m.num;
    kcA+=s.kc[ctx.estate?2:f.kc]*a; chioma+=a; pMin=Math.min(pMin, f.p??s.p);
  }
  if(+p.area>0){ kcA*=(+p.area)/chioma; chioma=+p.area; }
  const calib = ctx.eventi ? calibrazione(ctx.eventi, p.id, oggi) : 1;
  const base={sp,fa,fase:fe.fase,faseNome:nomeFase(p.specie,fe.fase),faseAuto:fe.auto,faseNota:fe.nota||'',faseRitmo:fe.ritmo??null,membri,nTot,num:membri[0].num,h,fl,interno,serra,calib,
    oggi, lat:ctx.lat, tcasa:interno?tempCasa(p):null};
  if(p.colt==='vaso'){
    const V=Math.max(0.3,+p.vaso||10);
    const D=+p.diametro>0 ? +p.diametro/100 : Math.cbrt(4*V/1000/(0.9*Math.PI));   // vaso alto ~0,9 × diametro
    const Apot=Math.PI*(D/2)**2;
    // in vaso la chioma è al massimo larga circa il doppio del vaso: senza superficie indicata, quella tipica della specie
    // si riduce (una pianta da appartamento in un vasetto da 7 cm non ha la chioma di 30×30 cm)
    if(!(+p.area>0)){ const max=4*Apot; if(chioma>max){ kcA*=max/chioma; chioma=max; } }
    const tawTerra=0.25*V*Math.max(0.6,1-0.06*(nTot-1));                              // più radici, meno acqua trattenuta
    // materiale: la terracotta perde acqua anche dalle pareti (+25%); «chiuso» = vaso senza fori, l'acqua in più ristagna
    const materiale=['terracotta','chiuso'].includes(p.materiale)?p.materiale:'plastica', fMat=materiale==='terracotta'?1.25:1;
    // sottovaso con riserva d'acqua: la pianta la beve dal basso prima di asciugare il terriccio
    const riserva=Math.max(0,Math.min(V,+p.riserva||0));
    const tawL=tawTerra+riserva;
    return {...base,vaso:true,V,D,Apot,chioma,area:Math.max(Apot,chioma),tawL,tawTerra,riserva,materiale,chiuso:materiale==='chiuso',
      rawL:tawTerra*pMin+riserva,pMin,lPerMm:(kcA+0.15*Apot)*fl*calib*fMat,pioggiaArea:Apot*0.8};
  }
  const area=+p.area>0 ? +p.area : chioma;
  const tawL=sp.radici*fa.radici*(p.colt==='rialzata'?0.8:1)*120*area;            // 120 mm per metro di terreno medio
  return {...base,vaso:false,chioma,area,tawL,rawL:tawL*pMin,pMin,lPerMm:kcA/chioma*area*fl*calib,pioggiaArea:area*0.85};
}
// in casa conta la temperatura della stanza in quel giorno (d.date; senza data, oggi)
export const consumoL = (k,d) => k.interno ? et0Casa(k.h*fattoreNuvole(d), tempCasaGiorno(k.tcasa, d?.date||k.oggi, k.lat), k.serra)*k.lPerMm : (d?.et0||0)*k.lPerMm*fattoreVaso(k,d);
// Effetto vaso all'aperto: l'ET0 conta già caldo e vento per il terreno, ma un vaso scalda e si asciuga anche dai lati.
// Con 30 °C o più: +15% per i vasi fino a 10 L al sole (5+ ore), +7% per gli altri; con vento da 30 km/h: +10% / +5%.
export function fattoreVaso(k,d){
  if(!k.vaso || k.interno || !d) return 1;
  let f=1;
  if(d.tmax>=30) f+= k.V<=10 && k.h>=5 ? 0.15 : 0.07;
  if(d.wind>=30) f+= k.V<=10 ? 0.10 : 0.05;
  return f;
}
export const pioggiaL = (p,k,d) => p.dove!=='aperto' ? 0 : Math.max(0,(d?.rain||0)-1.5)*k.pioggiaArea;
// Pioggia prevista: conta quella attesa, non quella massima. Con probabilità 80% o più vale tutta, sotto in proporzione
// (20 mm al 56% contano 14 mm): così una pioggia incerta non fa saltare un'innaffiatura che serve.
export const pioggiaAttesa = d => !d || d.prob==null ? d : {...d, rain:(d.rain||0)*Math.min(1,Math.max(0,d.prob)/80)};

/* ---------------- Piano locale (bilancio idrico giorno per giorno) ----------------
   opts = {piante, past, fut, eventi, oggi, lat, vacanza:{dal, al}}  (al = giorno del rientro) */
export function inVacanza(v, data){ return !!(v&&v.dal&&v.al&&data>=v.dal&&data<v.al); }
// Umidità del suolo (Open-Meteo, m³/m³, media 0–27 cm): per le piante in piena terra all'aperto sostituisce
// la stima dei giorni passati, se nessuno le ha innaffiate negli ultimi 3 giorni. Terreno medio: capacità di campo 0,32, appassimento 0,12.
const CAMPO=0.32, APPASS=0.12;
export function deficitDaSuolo(theta){ return Math.max(0,Math.min(1,(CAMPO-theta)/(CAMPO-APPASS))); }
export function pianoLocale({piante, past=[], fut=[], eventi=[], oggi, lat, vacanza, suolo=null}){
  const out={avvisi:[], piante:[]}, chiusiBagnati=new Set();
  if(!fut.length) return out;
  for(const p of piante){
    const k=params(p,{oggi,lat,eventi});
    const fatte=dateInnaffiate(p,eventi);
    let dep=k.rawL*0.5;
    const usaSuolo = suolo!=null && isFinite(suolo) && !k.vaso && p.dove==='aperto' && ![...fatte].some(d=>d>=addDays(oggi,-3));
    if(usaSuolo) dep=deficitDaSuolo(suolo)*k.tawL;
    else for(const d of past){ dep=Math.min(k.tawL,Math.max(0,dep+consumoL(k,d)-pioggiaL(p,k,d))); if(fatte.has(d.date)) dep=0; }
    if(fatte.has(oggi)) dep=0;
    // acqua nel terriccio a fine giornata (0-1, prima di un'eventuale innaffiatura) e tacca sotto la quale si innaffia
    let acqua=+(1-dep/k.tawL).toFixed(2); const soglia=+(1-k.rawL/k.tawL).toFixed(2);
    const giorni=[];
    fut.forEach((d,i)=>{
      const pl=pioggiaL(p,k,d.date>=oggi?pioggiaAttesa(d):d);
      if(k.chiuso && pl>0 && dep+consumoL(k,d)-pl < -0.1*k.tawL) chiusiBagnati.add(p.nome);
      let end=Math.min(k.tawL,Math.max(0,dep+consumoL(k,d)-pl));
      if(i===0 && !fatte.has(oggi)) acqua=+Math.max(0,1-end/k.tawL).toFixed(2);
      const next=fut[i+1], momento=d.tmin<=2&&!k.interno?'metà giornata':'mattina presto';
      const innaffia=(motivo,extra=1.1)=>{ const l=Math.max(0.05,end*(k.vaso&&!k.chiuso?extra:1)); const g={data:d.date,azione:'innaffia',litri:+l.toFixed(l<2?2:1),momento,motivo}; end=0; return g; };
      let g;
      if(fatte.has(d.date) && d.date!==oggi){ g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Già innaffiata'}; end=0; }
      else if(vacanza && vacanza.dal===addDays(d.date,1) && end>k.tawL*0.15){ g=innaffia('Domani parti: bagna a fondo finché esce dal foro',1.15); }
      else if(inVacanza(vacanza,d.date)){
        if(end>=k.tawL*0.95) g=innaffia('Sei via: serve qualcuno che la bagni');
        else g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Sei via: la riserva basta ancora'};
      }
      else if(pl>=k.rawL*0.25 && pl>0.05 && end<k.rawL) g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'La pioggia basta (~'+fmtN(Math.min(pl,k.tawL))+' L utili)'};
      else if(end>=k.rawL){
        const nr=next?pioggiaL(p,k,pioggiaAttesa(next)):0;
        if(next&&nr>=end*0.6&&(next.prob??0)>=60&&end<k.tawL*0.85) g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Rinvia: pioggia prevista domani ('+fmtN(next.rain)+' mm)'};
        else g=innaffia((k.vaso?'Vaso asciutto al ':'Riserva consumata al ')+Math.round(end/k.tawL*100)+'%'+(!k.vaso?'':k.chiuso?': vaso senza fori, dai solo questa dose':', bagna finché esce dal foro')+(k.riserva?' e riempi la riserva':''));
      }
      else if(end>=k.rawL*0.8) g={data:d.date,azione:'controlla',litri:0,momento:'indifferente',motivo:'Tocca il terriccio: se asciutto a 2–3 cm, innaffia'};
      else g={data:d.date,azione:'salta',litri:0,momento:'indifferente',motivo:'Terriccio ancora umido'};
      giorni.push(g); dep=end;
    });
    const prima=giorni.find(g=>g.azione==='innaffia'), ctrl=giorni.find(g=>g.azione==='controlla');
    const valutazione=prima ? 'Prossima innaffiatura: '+(prima.data===oggi?'oggi':giornoBreve(prima.data))+', '+fmtN(prima.litri,prima.litri<2?2:1)+' L.'
      : ctrl ? 'Nei prossimi giorni basta la riserva; '+giornoBreve(ctrl.data)+' tocca il terriccio.' : 'Nei prossimi '+giorni.length+' giorni non serve acqua.';
    out.piante.push({id:p.id, acqua, soglia, valutazione, fabbisogno_settimanale_litri:+giorni.reduce((a,g)=>a+g.litri,0).toFixed(1), giorni, consigli:consigliPianta(p)});
  }
  const minT=Math.min(...fut.map(d=>d.tmin)), maxT=Math.max(...fut.map(d=>d.tmax));
  const freddo=piante.filter(p=>p.dove!=='interno' && minT<=gelo(p)-(p.dove==='serra'?4:0));
  if(freddo.length) out.avvisi.push('Minima fino a '+fmtN(minT)+' °C: proteggi '+freddo.map(p=>p.nome).join(', ')+'.');
  if(chiusiBagnati.size) out.avvisi.push('Pioggia sui vasi senza fori ('+[...chiusiBagnati].join(', ')+'): dopo la pioggia inclina il vaso e togli l\'acqua in più, altrimenti le radici marciscono.');
  if(maxT>=33) out.avvisi.push('Caldo intenso (fino a '+fmtN(maxT)+' °C): innaffia all\'alba e controlla i vasi piccoli anche la sera.');
  // grandine nei prossimi 3 giorni (domani lo dice anche l'avviso della sera): per preparare teli o un riparo
  const gr=fut.slice(0,3).find(d=>+d.code===96||+d.code===99), scoperte=piante.filter(p=>p.dove==='aperto'||!p.dove);
  if(gr&&scoperte.length) out.avvisi.push('Possibile grandine '+(gr.date===oggi?'oggi':new Date(gr.date+'T12:00:00').toLocaleDateString('it-IT',{weekday:'long'}))+': tieni pronti teli o un riparo per '+scoperte.map(p=>p.nome).join(', ')+'.');
  out.sintesi=sintesiSettimana(out, fut, piante);
  return out;
}
const giornoBreve = iso => new Date(iso+'T12:00:00').toLocaleDateString('it-IT',{weekday:'short',day:'numeric'});
// Due righe sulla settimana, come le scriverebbe un giardiniere: meteo, chi va bagnato e quando, chi no.
export function sintesiSettimana(piano, fut, piante){
  if(!fut.length) return '';
  const rain=fut.reduce((a,d)=>a+(d.rain||0),0), minT=Math.min(...fut.map(d=>d.tmin)), maxT=Math.max(...fut.map(d=>d.tmax));
  const max=fut.reduce((a,d)=>(d.rain||0)>(a.rain||0)?d:a,fut[0]);
  let t='Prossimi '+fut.length+' giorni: '+fmtN(rain)+' mm di pioggia'+((max.rain||0)>=5?' (la più forte '+giornoBreve(max.date)+', '+fmtN(max.rain,0)+' mm)':'')+', temperature tra '+fmtN(minT,0)+' e '+fmtN(maxT,0)+' °C.';
  const nome=id=>piante.find(p=>p.id===id)?.nome||'';
  const si=[], no=[];
  for(const pp of piano.piante){ const g=pp.giorni.filter(x=>x.azione==='innaffia'); if(!nome(pp.id)) continue;
    if(g.length) si.push(nome(pp.id)+' '+g.map(x=>giornoBreve(x.data)).join(', ')); else no.push(nome(pp.id)); }
  si.sort((a,b)=>a.localeCompare(b,'it')); no.sort((a,b)=>a.localeCompare(b,'it'));
  if(si.length) t+=' Da innaffiare: '+si.join('; ')+'.';
  if(no.length) t+=' '+(no.length===1?no[0]+': niente acqua':no.slice(0,-1).join(', ')+' e '+no.at(-1)+': niente acqua')+(rain>=10&&piante.some(p=>!alCoperto(p)&&no.includes(p.nome))?', basta la pioggia o la riserva.':', basta la riserva.');
  return t;
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

/* ---------------- Meteo di riserva: MET Norway (servizio meteorologico norvegese, gratuito) ----------------
   Se Open-Meteo non risponde. Previsioni ora per ora per ~2 giorni, poi ogni 6 ore fino a ~9 giorni (ore in UTC).
   Si sommano per giorno locale: pioggia (next_1_hours finché c'è, poi next_6_hours), minima e massima, vento;
   l'ET0 si stima con Hargreaves dalle temperature. Niente probabilità di pioggia, umidità del suolo o grandine. */
export const urlMet = (lat, lon) => `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`;
const COD_MET = s => /thunder/.test(s)?95: /snow|sleet/.test(s)?71: /rain/.test(s)?61: /fog/.test(s)?45: /^cloudy/.test(s)?3: /partlycloudy|fair/.test(s)?2: 0;
export function giorniDaMet(j, tz, lat, oggi, ora){
  const ts=j?.properties?.timeseries||[], fmt=new Intl.DateTimeFormat('en-CA',{timeZone:tz||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  const loc=t=>{ const p=Object.fromEntries(fmt.formatToParts(new Date(t)).map(x=>[x.type,x.value])); return {d:p.year+'-'+p.month+'-'+p.day, h:+p.hour}; };
  const per={}, notte=[], da=oggi, a=addDays(oggi,1);
  ts.forEach((x,i)=>{
    const {d,h}=loc(x.time), g=per[d]||(per[d]={date:d,tmax:-99,tmin:99,rain:0,wind:0,cod:{}}), det=x.data?.instant?.details||{};
    if(det.air_temperature!=null){ g.tmax=Math.max(g.tmax,det.air_temperature); g.tmin=Math.min(g.tmin,det.air_temperature);
      if((d===da&&h>=18)||(d===a&&h<=10)) notte.push({ora:String(h).padStart(2,'0'), t:det.air_temperature}); }
    if(det.wind_speed!=null) g.wind=Math.max(g.wind,det.wind_speed*3.6);
    const n1=x.data?.next_1_hours, n6=x.data?.next_6_hours, prossimo=ts[i+1]?Date.parse(ts[i+1].time)-Date.parse(x.time):0;
    if(n1 && prossimo<=3600e3) g.rain+=n1.details?.precipitation_amount||0;
    else if(n6){ g.rain+=n6.details?.precipitation_amount||0;
      if(n6.details?.air_temperature_max!=null){ g.tmax=Math.max(g.tmax,n6.details.air_temperature_max); g.tmin=Math.min(g.tmin,n6.details.air_temperature_min); } }
    const sym=(n1||n6||x.data?.next_12_hours)?.summary?.symbol_code; if(sym){ const c=COD_MET(sym); g.cod[c]=(g.cod[c]||0)+1; }
  });
  const days=Object.values(per).filter(g=>g.date>=oggi && g.tmax>-99).map(g=>{
    const code=+Object.entries(g.cod).sort((x,y)=>y[1]-x[1]||(+y[0])-(+x[0]))[0]?.[0]||0, d={date:g.date, cond:condizioneMeteo(code), code, tmax:+g.tmax.toFixed(1), tmin:+g.tmin.toFixed(1),
      rain:+g.rain.toFixed(1), prob:null, wind:Math.round(g.wind), raffiche:null, sole:null};
    return {...d, et0:et0Hargreaves(d, lat)??0};
  }).slice(0,8);
  return {days, notte:notte.length?notte:null};
}

/* ---------------- Pioggia misurata (stazioni ARPAE in Emilia-Romagna) ----------------
   mis = {stazione, km, giorni:{AAAA-MM-GG: mm}} (solo giorni completi): nei giorni passati sostituisce la pioggia
   stimata dal modello; rain_modello tiene quella di prima. */
export function conPioggiaMisurata(days, mis, oggi){
  if(!mis?.giorni || !Array.isArray(days)) return days;
  return days.map(d=>{ const v=mis.giorni[d.date]; return d.date<oggi && v!=null && isFinite(v) && !d.misurata ? {...d, rain:+(+v).toFixed(1), rain_modello:d.rain, misurata:true} : d; });
}

/* ---------------- Primi giorni da due modelli ----------------
   Per i primi giorni (fino a 3, quelli che ICON-2I copre per intero, ora per ora) pioggia, massima e minima sono la media
   tra il modello scelto da Open-Meteo (in Italia di solito ICON-D2/ICON-EU del servizio tedesco) e ICON-2I di
   ItaliaMeteo-ARPAE (2,2 km, tarato su Alpi e Appennini): un modello solo sbaglia spesso dove cade un temporale,
   la media sbaglia meno. La probabilità di pioggia resta quella di Open-Meteo (ICON-2I non la dà).
   Fuori dall'area di ICON-2I i valori sono vuoti e restano i dati di partenza. */
export const MODELLO_IT='italia_meteo_arpae_icon_2i';
export const MODELLO_IT_PARAMS='precipitation,temperature_2m';
// h = risposta "hourly" di ICON-2I (time locale, precipitation, temperature_2m)
export function mediaModelli(days, h, oggi){
  if(!h?.time || !Array.isArray(h.precipitation)) return days;
  const per={};
  h.time.forEach((t,i)=>{ const d=t.slice(0,10); (per[d]||(per[d]={p:[],t:[]})); per[d].p.push(h.precipitation[i]); per[d].t.push(h.temperature_2m?.[i]); });
  const fine=addDays(oggi,2), ok=a=>a.length>=23 && a.every(x=>x!=null && isFinite(x)), m=(a,b)=>+((a+b)/2).toFixed(1);
  return days.map(d=>{
    const x=per[d.date];
    if(d.date<oggi || d.date>fine || !x || !ok(x.p)) return d;
    const r=x.p.reduce((a,b)=>a+b,0), out={...d, rain:m(d.rain,r), rain_modelli:[d.rain,+r.toFixed(1)]};
    if(ok(x.t) && d.tmax!=null && d.tmin!=null){ out.tmax=m(d.tmax,Math.max(...x.t)); out.tmin=m(d.tmin,Math.min(...x.t)); }
    return out;
  });
}

/* ---------------- Gelo, caldo, vento, temporale e grandine ---------------- */
export function gelo(p){ const sp=SPECIE[p.specie]||SPECIE.altro; return sp.gelo+(p.colt==='vaso'?2:0); }   // le radici in vaso gelano prima
// notte (facoltativa) = temperature orarie dalla sera di oggi alla mattina di domani: [{ora:'HH', t}]
export function avvisiDomani(piante, domani, notte){
  if(!domani) return [];
  const out=[], fuori=piante.filter(p=>!alCoperto(p)), daGelo=piante.filter(p=>p.dove!=='interno');
  const oraria = Array.isArray(notte) && notte.length ? notte : null;
  const minima = oraria ? Math.min(...oraria.map(x=>x.t)) : domani.tmin;
  const sogliaGelo=p=>gelo(p)-(p.dove==='serra'?4:0);   // il vetro della serra tiene circa 4 gradi
  const fredde=daGelo.filter(p=>minima<=sogliaGelo(p));
  if(fredde.length){
    let testo='Minima di '+fmtN(minima)+' °C';
    if(oraria){
      const soglia=Math.max(...fredde.map(sogliaGelo)), sotto=oraria.filter(x=>x.t<=soglia), piu=oraria.find(x=>x.t===minima);
      testo='Stanotte minima di '+fmtN(minima)+' °C verso le '+piu.ora+':00'+(sotto.length>1?' (sotto '+fmtN(soglia)+' °C dalle '+sotto[0].ora+':00 alle '+sotto[sotto.length-1].ora+':00)':'');
    }
    const fuoriF=fredde.filter(p=>p.dove!=='serra'), serraF=fredde.filter(p=>p.dove==='serra');
    const cosa=[fuoriF.length?'porta al riparo o copri con tessuto non tessuto '+fuoriF.map(p=>p.nome).join(', '):'', serraF.length?'in veranda/serra chiudi bene e copri '+serraF.map(p=>p.nome).join(', '):''].filter(Boolean).join('; ');
    out.push({tipo:'gelo', testo:testo+': '+cosa+'.', piante:fredde.map(p=>p.id)});
  }
  if(domani.tmax>=33){
    const delicate=fuori.filter(p=>(p.colt==='vaso'&&(+p.vaso||10)<=10&&luceOre(p)>=5)||['lattuga','fragola','ortensia','basilico'].includes(p.specie));
    if(delicate.length) out.push({tipo:'caldo', testo:'Massima di '+fmtN(domani.tmax)+' °C: bagna all\'alba e sposta all\'ombra nel pomeriggio '+delicate.map(p=>p.nome).join(', ')+'.', piante:delicate.map(p=>p.id)});
  }
  // temporale (codice meteo 95) e temporale con grandine (96, 99: Open-Meteo li dà dove il modello li calcola, Italia compresa)
  const cod=+domani.code||0, scoperte=piante.filter(p=>p.dove==='aperto'||!p.dove);
  if(cod===96||cod===99){
    const vasi=scoperte.filter(p=>p.colt==='vaso'), terra=scoperte.filter(p=>p.colt!=='vaso');
    const cosa=[vasi.length?'metti al riparo '+vasi.map(p=>p.nome).join(', '):'', terra.length?'copri con un telo, una cassetta o una rete antigrandine '+terra.map(p=>p.nome).join(', '):''].filter(Boolean).join('; ');
    if(cosa) out.push({tipo:'grandine', testo:'Temporale con possibile grandine: '+cosa+'.', piante:scoperte.map(p=>p.id)});
  } else if(cod===95){
    const chiusi=fuori.filter(p=>p.colt==='vaso'&&p.materiale==='chiuso'), leggeri=fuori.filter(p=>p.colt==='vaso'&&(+p.vaso||10)<=10);
    const cosa=[leggeri.length?'avvicina al muro i vasi leggeri ('+leggeri.map(p=>p.nome).join(', ')+')':'', chiusi.length?'dopo, svuota l\'acqua in più dai vasi senza fori ('+chiusi.map(p=>p.nome).join(', ')+')':''].filter(Boolean).join('; ');
    if(cosa) out.push({tipo:'temporale', testo:'Temporale'+((domani.rain||0)>=1?' (circa '+fmtN(domani.rain,0)+' mm)':'')+': '+cosa+'.', piante:[...new Set([...leggeri,...chiusi].map(p=>p.id))]});
  }
  // vento medio da 50 km/h o raffiche da 60 km/h
  const raff=+domani.raffiche||0;
  if((domani.wind||0)>=50||raff>=60){ const vasi=fuori.filter(p=>p.colt==='vaso'); if(vasi.length) out.push({tipo:'vento', testo:((domani.wind||0)>=50?'Vento fino a '+Math.round(domani.wind)+' km/h'+(raff>domani.wind?', raffiche fino a '+Math.round(raff):''):'Raffiche fino a '+Math.round(raff)+' km/h')+': lega o avvicina al muro i vasi alti ('+vasi.map(p=>p.nome).join(', ')+').', piante:vasi.map(p=>p.id)}); }
  return out;
}

/* ---------------- Diagnosi guidata (senza foto e senza Claude) ----------------
   L'utente spunta i sintomi; il punteggio dice se il problema è l'acqua (troppa o poca) o altro.
   «registra» = meno | piu: la correzione che l'app può imparare (come le risposte «umido» e «secco»). */
export const SINTOMI = [
  {id:'bagnato', testo:'Il terriccio è ancora bagnato a 2–3 cm, anche giorni dopo', troppa:3},
  {id:'secco', testo:'Il terriccio è secco, duro o staccato dalle pareti del vaso', poca:3},
  {id:'appassita', testo:'Foglie afflosciate o cadenti'},
  {id:'gialle_molli', testo:'Foglie basse gialle e molli', troppa:2},
  {id:'croccanti', testo:'Foglie secche e croccanti, bordi arricciati', poca:2},
  {id:'marciume', testo:'Base del fusto scura o molle, odore di marcio', troppa:3},
  {id:'moscerini', testo:'Moscerini o muffa bianca sul terriccio', troppa:2},
  {id:'punte', testo:'Solo le punte o i bordi delle foglie marroni'},
  {id:'pallide', testo:'Foglie nuove pallide o gialle tra le nervature verdi'},
  {id:'filata', testo:'Fusti lunghi e deboli, piegati verso la luce'},
  {id:'polvere', testo:'Polvere bianca sulle foglie'},
  {id:'ragnatele', testo:'Puntini chiari e sottili ragnatele sotto le foglie'},
  {id:'bruciate', testo:'Macchie chiare e secche sul lato al sole'}
];
export function diagnosi(sintomi, p={}){
  const s=new Set(sintomi||[]), sp=SPECIE[p.specie]||SPECIE.altro;
  let troppa=0, poca=0;
  for(const x of SINTOMI) if(s.has(x.id)){ troppa+=x.troppa||0; poca+=x.poca||0; }
  if(s.has('appassita')){ if(s.has('bagnato')||s.has('marciume')) troppa+=3; else if(s.has('secco')) poca+=3; else poca+=1; }
  const altri=[];
  if(s.has('punte')) altri.push(sp.acquaDolce ? 'Punte marroni: per questa pianta l\'acqua del rubinetto è troppo calcarea. Usa acqua piovana o distillata.' : 'Punte marroni: aria troppo secca o acqua calcarea. Lontano dai termosifoni; nebulizza o usa acqua piovana.');
  if(s.has('pallide')) altri.push('Foglie nuove pallide con le nervature verdi: manca ferro o il terriccio è troppo calcareo. Un concime con microelementi (ferro chelato) risolve in 2–3 settimane.');
  if(s.has('filata')) altri.push('Fusti lunghi verso la luce: ha poca luce. Spostala in un posto più luminoso, piano piano se prima era all\'ombra.');
  if(s.has('polvere')) altri.push('Polvere bianca: è oidio (mal bianco), un fungo. Togli le foglie colpite, bagna solo al piede, lascia circolare l\'aria.');
  if(s.has('ragnatele')) altri.push('Puntini e ragnatele: ragnetto rosso, ama l\'aria secca. Lava le foglie sotto la doccia e nebulizza spesso.');
  if(s.has('bruciate')) altri.push('Macchie chiare sul lato al sole: scottature. Abituala al sole piano piano o ombreggia nelle ore calde.');
  let r;
  if(troppa>=3 && troppa>=poca+2) r={verdetto:'troppa', titolo:'Troppa acqua', registra:'meno',
    testo:'Le radici stanno senza aria. Non bagnare finché i primi 3–4 cm non sono asciutti, svuota il sottovaso e controlla che il foro non sia chiuso.'+(s.has('marciume')?' Se la base è molle, sfila la pianta: taglia le radici scure e rinvasa in terriccio nuovo e asciutto.':''),
    impara:'L\'app conterà che questa pianta beve meno e allungherà gli intervalli.'};
  else if(poca>=3 && poca>=troppa+2) r={verdetto:'poca', titolo:'Poca acqua', registra:'piu',
    testo:'Bagna a fondo, finché l\'acqua esce dal foro'+(s.has('secco')?'; se il terriccio è staccato dal vaso, immergi il vaso in un secchio d\'acqua per 15–20 minuti':'')+'. Le foglie si riprendono in qualche ora; quelle croccanti non tornano verdi.',
    impara:'L\'app conterà che questa pianta beve di più e accorcerà gli intervalli.'};
  else if(troppa+poca>0) r={verdetto:'incerto', titolo:'Non è chiaro', registra:null,
    testo:'I segni vanno in direzioni diverse. Infila un dito nel terriccio per 3 cm: se è bagnato aspetta, se è secco bagna. Poi rispondi ai promemoria con «Terreno ancora umido» o «Era secca»: l\'app impara da lì.'};
  else r={verdetto:altri.length?'altro':'bene', titolo:altri.length?'Non è l\'acqua':'Nessun segno di problemi d\'acqua', registra:null, testo:altri.length?'':'Se qualcosa non ti convince, controlla il terriccio con un dito prima di ogni innaffiatura.'};
  return {...r, altri, punti:{troppa, poca}};
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

/* ---------------- Meteo: richieste e lettura, uguali per app e server ----------------
   Due richieste a Open-Meteo, in parallelo: (1) il modello scelto da Open-Meteo, giornaliero e orario insieme
   (3 giorni passati e 8 previsti; dall'orario: umidità del suolo e temperature della notte); (2) ICON-2I ora per ora
   per la media dei primi giorni. Se la seconda non risponde, la prima basta. */
export const DAILY_PARAMS='weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max,wind_gusts_10m_max,sunshine_duration,daylight_duration';
export function urlMeteo(lat, lon){
  const q=o=>'https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:lat, longitude:lon, timezone:'auto', ...o});
  return {base:q({past_days:'3', forecast_days:'8', daily:DAILY_PARAMS, hourly:ORARIO_PARAMS}), it:q({forecast_days:'3', hourly:MODELLO_IT_PARAMS, models:MODELLO_IT})};
}
export const condizioneMeteo = c => c===0?'sereno': c<=2?'poco nuvoloso': c===3?'nuvoloso': (c===45||c===48)?'nebbia': c>=95?'temporale': ((c>=71&&c<=77)||c===85||c===86)?'neve': 'pioggia';
// j = risposta della richiesta (1), jIT = della (2) o null; oggi e ora nel fuso della posizione (j.timezone)
export function componiMeteo(j, jIT, oggi, ora){
  const d=j.daily;
  let days=d.time.map((t,i)=>({date:t, cond:condizioneMeteo(d.weather_code[i]), tmax:d.temperature_2m_max[i], tmin:d.temperature_2m_min[i],
    rain:d.precipitation_sum[i]??0, prob:d.precipitation_probability_max[i], et0:d.et0_fao_evapotranspiration[i]??0, wind:d.wind_speed_10m_max[i],
    raffiche:d.wind_gusts_10m_max?.[i]??null, code:d.weather_code[i],
    sole:d.sunshine_duration?.[i]!=null && d.daylight_duration?.[i]>0 ? +(d.sunshine_duration[i]/d.daylight_duration[i]).toFixed(2) : null}));
  if(jIT?.hourly) days=mediaModelli(days, jIT.hourly, oggi);
  return {tz:j.timezone||'Europe/Rome', days, ...datiOrari(j.hourly, oggi, ora)};
}

/* ---------------- Calendario dei mesi (automatico, dal modello) ----------------
   Annuali con data di semina/trapianto: un mese per riga dalla semina alla fine del ciclo.
   Perenni: l'anno tipico, da gennaio a dicembre. Per ogni mese: fase, se fa frutti, se è tempo di raccolta. */
export const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
export function calendarioAuto(p, lat){
  const sp=SPECIE[p.specie]||SPECIE.altro, bulbo=!!sp.fasiNomi?.fruttificazione;
  const voce=(mese,fase)=>({mese, fase, nome:nomeFase(p.specie,fase), frutti:fase==='fruttificazione'&&!bulbo, raccolta:fase==='maturazione'});
  if(sp.ann){
    if(!p.data_semina) return {tipo:null, mesi:[]};
    const inizio=p.data_semina, fineCiclo=sp.ciclo.filter(x=>x!=null).pop();
    // ultimo giorno del ciclo: con i gradi-giorno può essere prima o dopo dei giorni tipici
    let ultimo=addDays(inizio, Math.max(0, fineCiclo-(p.tipo_data==='trapianto'?sp.trap:0)-1));
    if((GRADI[p.specie] && CLIMA.has(kLat(lat))) || raccoltaDi(p)){ let a=inizio, b=addDays(inizio,600);
      while(giorniTra(a,b)>1){ const m=addDays(a,Math.floor(giorniTra(a,b)/2)); if(etaPianta(p,m,lat).eta<fineCiclo) a=m; else b=m; } ultimo=a; }
    const mesi=[]; let y=+inizio.slice(0,4), m=+inizio.slice(5,7);
    while(mesi.length<18){
      const mm=y+'-'+String(m).padStart(2,'0'); if(mm>ultimo.slice(0,7)) break;
      let giorno = mm===inizio.slice(0,7) ? inizio : mm+'-15'; if(giorno>ultimo) giorno=ultimo;
      mesi.push(voce(mm, faseEffettiva({...p, fase:'auto'}, giorno, lat).fase));
      if(++m>12){ m=1; y++; }
    }
    return {tipo:'ciclo', mesi};
  }
  const cal=sp.cal||SPECIE.altro.cal;
  return {tipo:'anno', mesi:MESI.map((_,i)=>voce(String(i+1).padStart(2,'0'), DA_LETTERA[cal[lat!=null&&lat<0?(i+6)%12:i]]))};
}
