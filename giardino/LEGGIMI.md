# Giardino

Piano di innaffiatura personalizzato (specie, fase di crescita, vaso, luce, zona, meteo) con promemoria su Telegram.
**Tutto gratuito**: sito su Netlify (piano gratuito), meteo Open-Meteo, Telegram, e Claude che ragiona nella chat
di claude.ai attraverso un connettore personalizzato, come per l'app Palestra.

App: **https://giardino-fede.netlify.app/**

## Come è fatto

| Pezzo | File | Cosa fa |
|---|---|---|
| App | `giardino-netlify/public/index.html` (costruita da `giardino/app.src.html` + `giardino/netlify-shim.js`), `manifest.webmanifest`, `sw.js`, icone | 4 schede: **Oggi** (meteo, cosa innaffiare con Fatto / Era umida / Salta, prossimi giorni), **Piante**, **Diario**, **Impostazioni** (posizione, Telegram, Claude, vacanza, misure, meteo a mano, sincronizzazione, backup); meteo diretto da Open-Meteo; schermo bloccato (niente zoom), nessuno scorrimento laterale da 320 px in su; installabile sulla Home e utilizzabile offline (le modifiche partono al ritorno della rete) |
| Calcolo | `giardino/modello.mjs` (copiato in `giardino-netlify/netlify/lib/`) | bilancio idrico in litri per vaso o aiuola; 36 specie in 6 gruppi (orto, aromatiche, frutti, fiori, in casa, altro) |
| Dati | `netlify/functions/dati.mjs` → Netlify Blobs | salvataggio con codice di sincronizzazione (nell'intestazione `x-giardino-code`, mai nell'indirizzo); chiave per Claude; collegamento del bot |
| Claude | `netlify/functions/mcp.mjs` → `/mcp/<chiave>` | connettore MCP 2.0 (12 strumenti): lettura `giardino`, `pianta`, `diario`; `diagnosi` (come nell'app, con `registra: true` salva la correzione); scrittura `salva_piano` (litri limitati a quanto trattiene il vaso), `piano_automatico`, `registra`, `annulla` (per id evento), `salva_scheda`, `modifica_pianta` (specie dal nome se manca), `impostazioni`, `vacanza` |
| Telegram | `netlify/functions/telegram.mjs` (webhook) + `bot.mjs` (ogni ora) | pulsanti **Annaffiato** / **Terreno ancora umido** (al mattino anche Salto), dopo la conferma **↩️ Annulla** per un tocco sbagliato; comandi /oggi /fatto [zona o pianta] /settimana /vacanza /aiuto; piano del mattino; la sera promemoria di ciò che manca e avvisi (gelo ora per ora, caldo, vento e raffiche, temporale, grandine); riepilogo la domenica; backup come file ogni mese |
| Prove | `giardino-netlify/test/`, `.github/workflows/giardino-test.yml` | a ogni modifica su GitHub: pagina ricostruita dai sorgenti, modello, funzioni del sito, interfaccia nel browser da 320 a 430 px |
| Sito online | `giardino-netlify/test/sito-online.mjs`, `.github/workflows/giardino-sito.yml` | dopo ogni modifica su main (aspetta fino a 12 min la pubblicazione) e ogni mattina: versione online = commit, pagina, manifest, dati, connettore, webhook Telegram. Se fallisce GitHub manda l'email. Facoltativi nei segreti del repository (Settings → Secrets and variables → Actions): `GIARDINO_CODE` e `GIARDINO_MCP` per provare anche i dati veri, solo in lettura |

Il promemoria del mattino usa il piano salvato da Claude se copre il giorno, altrimenti il calcolo automatico.
Meteo: dati giornalieri e, in una richiesta a parte, umidità del suolo (piante in piena terra) e temperature ora per ora della notte (gelo).

## Pubblicazione su Netlify (una volta)

Sito già creato: `giardino-fede` (Netlify). Collega il repository così ogni push pubblica da solo:
Netlify → progetto **giardino-fede** → Project configuration → Build & deploy → **Link repository** →
GitHub `fedefabbro2008-bit/Palestra`, branch `main`, **Base directory `giardino-netlify`**
(publish `public` e functions `netlify/functions` sono già in `netlify.toml`).

## Uso (una volta)

1. Apri l'app: scrivi il comune e aggiungi le piante (o prova con 3 esempi).
2. Impostazioni → **Claude** → Crea il collegamento → Copia l'indirizzo →
   claude.ai → Impostazioni → Connettori → Aggiungi connettore personalizzato (nome Giardino, URL copiato).
3. Impostazioni → **Telegram**: crea il bot con @BotFather, incolla il token, premi Collega, poi Avvia sul bot.
4. Impostazioni → **Backup** per salvare un file da reimportare dopo un cambio di versione o di telefono.

Ogni pianta ha una **Scheda** (Piante → pianta → Scheda): finché Claude non la scrive, l'app mostra il calendario dei mesi
stimato dal modello (dalla semina al raccolto per ortaggi e annuali, l'anno tipico per le perenni). Claude la compila con il
connettore (`salva_scheda`, oppure `modifica_pianta` con `campi.scheda` se il client ha ancora l'elenco di strumenti vecchio):
descrizione, condizioni ideali, stagioni, fasi di crescita per settimane o mesi, calendario dei mesi con frutti e raccolta, consigli.
Lo strumento `giardino` spiega a Claude come scriverla quando manca. Se cambi specie o data di semina, la scheda risulta da aggiornare.

Il piano di Claude copre circa 7 giorni (fin dove arrivano le previsioni): oltre l'ultimo giorno app e promemoria usano il calcolo
automatico, e la sera prima dell'ultimo giorno Telegram invita ad aggiornarlo, con il pulsante «Apri Claude» (una volta per piano).

Le piante si possono dividere in **zone** (Balcone, Orto…): in Oggi ogni zona ha il suo “Tutte annaffiate”,
su Telegram `/fatto balcone` segna solo quella zona. Elenchi e specie sono in ordine alfabetico; la specie si cerca scrivendone il nome.

## Modifiche al codice

Modifica `giardino/app.src.html`, `giardino/modello.mjs` o `giardino/netlify-shim.js`, poi `node giardino/build-app.mjs`
e push su `main`. Nessuna chiave API a pagamento: Claude lavora solo attraverso il connettore.

Prove in locale (dalla cartella `giardino-netlify`, con Playwright installato in `test/`): `npm test`.
Su GitHub partono da sole a ogni push (Actions → “Giardino · prove”).

## Senza Claude (tutto dentro l'app)
- **Meteo da più modelli** (`ensembleGiorni`): una richiesta con ICON-2I (ItaliaMeteo-ARPAE, 2,2 km), ICON, Météo-France, ECMWF IFS, UK Met Office e GFS. Pioggia, minima, massima ed evaporazione sono la media pesata dei modelli che coprono il giorno (i primi giorni pesano di più i modelli fitti, poi ECMWF); la probabilità unisce quella di Open-Meteo e la quota di modelli con almeno 1 mm; per il gelo conta anche il modello più freddo + 1 °C (`tmin_freddo`). Con meno di due modelli resta la previsione di base (e, se c'è, la media con ICON-2I ora per ora).
- **Specie riconosciuta dal nome** («Nepenthes mirabilis» → Nepenthes, «Pomodori ciliegini» → Pomodoro): nuova pianta = scelta da sola; pianta come «Altra pianta» = proposta nella scheda.
- **Scheda dell'app** per ogni specie: descrizione, condizioni ideali, stagioni (perenni) o fasi settimana per settimana (annuali), calendario dei mesi, consigli della specie + consigli dai dati della pianta (vaso, luce, posto). La scheda di Claude, se c'è, la sostituisce.
- **Diagnosi guidata** (Scheda → Come sta?): sintomi da spuntare → troppa o poca acqua (registra «meno»/«più» e il calcolo impara) o altre cause (calcare, ferro, luce, oidio, ragnetto, scottature).
- **Sintesi della settimana e prossima innaffiatura** per pianta anche nel calcolo automatico (app, Telegram /settimana, connettore).

## Precisione e riserve (senza Claude)
- **Sole secondo la stagione**: con «Verso dove guarda» (bussola nella scheda della pianta) le ore di sole scritte valgono per quel giorno (`luce_data`) e cambiano da sole con le stagioni (geometria del sole, `oreSoleGeom`). In casa e in veranda la luce del giorno segue anche il sole previsto (`sunshine_duration`).
- **Bilancio dell'acqua con memoria** (`bilancioPassato`, `giorniPassati`): l'acqua nel terriccio parte dall'ultima innaffiatura o dall'ultimo controllo col dito (fino a 120 giorni prima) e segue giorno per giorno il meteo vero dei giorni passati (storico di Open-Meteo: pioggia, evaporazione, sole, vento; pioggia misurata ARPAE). «Era ancora umida» porta lo stato al più al 60% della tacca, «asciutta» almeno alla tacca. Prima partiva sempre da metà tacca tre giorni fa e, per le piante che bevono poco, l'innaffiatura scivolava avanti ogni giorno. Nella scheda: «Acqua calcolata dal …».
- **Calibrazione dalle risposte** (`stimaConsumo`): il fattore di consumo (0,4–2,5) è quello che rende il bilancio più coerente con i controlli fatti dopo un'innaffiatura, tanto più spostato quanto più il calcolo sbagliava (errore in rapporto); le risposte coerenti non cambiano niente, quelle vecchie pesano meno (metà dopo ~6 settimane), la diagnosi da foto sposta il punto di partenza. App, Telegram e connettore vedono lo stesso valore (`calibrazione`).
- **Fasi a gradi-giorno orari** (`GRADI` = base, riferimento, ottimo, massima; `ritmoGiorno`): il ritmo di crescita si calcola sulle 24 ore tra minima e massima (non sulla media) e oltre l'ottimo cala fino a fermarsi; temperature vere (storico, 400 giorni), poi previsioni e stessa settimana dell'anno prima (`etaEquivalente`).
- **Fotoperiodo** (aglio 13 h, cipolla 13,5 h di luce, `durataGiorno`): il bulbo comincia solo con le giornate lunghe; prima la pianta resta in crescita vegetativa e la scheda dice da quando.
- **Kc che cresce con l'età** delle annuali (`kcContinuo`, FAO-56): sale durante lo sviluppo e cala durante la maturazione invece di cambiare a scatti.
- **Controllo della settimana**: sabato e domenica, una pianta da toccare con il dito (app e Telegram il sabato); la risposta si confronta con l'acqua calcolata e il calcolo impara (`verificaDaFare`, `esitoVerifica`).
- **Meteo di riserva**: se Open-Meteo non risponde, MET Norway dal server (giorni passati dall'ultimo meteo buono); l'app lo chiede al server (`?op=meteo`).
- **Pioggia misurata**: ogni 3 ore il bot legge le stazioni ARPAE-SIMC (open data, solo Emilia-Romagna) e scrive nei dati i giorni completi della stazione più vicina (`pioggia_misurata`, ultimi 60 giorni): nei giorni passati prende il posto della pioggia stimata. La stazione di Castrocaro misura solo la pioggia: le temperature vicine (Forlì città, colline) non sono rappresentative, quindi le minime non si correggono con le stazioni.
- **Bot di riserva su GitHub** (`giardino/riserva.mjs`, `.github/workflows/giardino-riserva.yml`, ogni mattina): sito vivo → copia cifrata dei dati nella cache di GitHub Actions; sito fermo (es. crediti finiti) → messaggio del mattino su Telegram da GitHub. Segreti: `GIARDINO_CODE`, `GIARDINO_TG_TOKEN`, `GIARDINO_TG_CHAT` (il numero è in Impostazioni → Telegram).
- **Crediti**: in Impostazioni → Crediti Netlify si scrive il valore vero letto su Netlify e la stima riparte da lì.
- **Notifiche** (Impostazioni → Notifiche, o Claude con lo strumento `impostazioni`): un interruttore per ogni messaggio del bot — piano del mattino, promemoria della sera, avvisi per domani, controllo del sabato, riepilogo della domenica, backup mensile, fine del piano di Claude, crediti Netlify. Salvate in `impostazioni.notifiche` (`{tipo: false}` per quelle spente; i tipi nuovi partono accesi). Le risposte ai comandi e il messaggio di riserva da GitHub arrivano sempre. Con il mattino spento la sera arriva lo stesso il promemoria delle piante di oggi; con mattino e sera spenti nessuna pianta viene segnata, quindi niente innaffiature presunte. Meteo e piano si calcolano solo se servono a una notifica accesa.
- **Badge «Powered by Netlify»** (piano gratuito, iframe `#nl-badge-frame`): l'app lo mette in alto a destra, al 70%, sotto la fotocamera (`html.con-badge` lascia 30 px in cima solo quando c'è); scorre via con la pagina e non copre le schede in basso.
- **Le tue piante** (in Oggi, al posto di «Oggi non serve acqua»): tutte le piante, sempre, con 💧 annaffiata, 🌧 sotto la pioggia (solo al riparo, in veranda o in casa) e 🖐 «Com'è la terra?». Il controllo dice a quanti centimetri toccare (`profonditaDito`: semi appena seminati la superficie, vasetti fino a 1 L 2 cm, fino a 5 L 3 cm, fino a 20 L 4 cm, più grandi e piena terra 5 cm; lo usano anche il controllo del sabato e Telegram) e registra una «verifica» umida/asciutta che corregge il consumo di quella pianta; se è asciutta l'app la mette da annaffiare.
- **Riconoscimento da foto** (modulo della pianta → «📷 Riconosci da una foto»): la foto si rimpicciolisce sul telefono (1280 px, JPEG) e va al sito (`POST /api/dati?op=riconosci`, serve il codice), che la manda a **Pl@ntNet** con la chiave `PLANTNET_KEY` (variabile d'ambiente su Netlify, mai nell'app; gratis fino a 500 al giorno). Tornano 3 specie con la probabilità e la specie dell'app corrispondente (nome comune, scientifico o genere); toccandone una si compilano nome e specie. Senza chiave l'app dice che non è attivo.
- **Emoji della pianta**: nel modulo si sceglie la «foto» della pianta (30 emoji pronte o qualunque emoji dalla tastiera, campo `emoji`); vuota = quella della specie. Anche dal connettore (`emoji`).
- **Verso dove guarda**: una o più direzioni (balcone d'angolo, es. Sud e Ovest → `orient: "S,O"`), «Aperto» o «Non lo so» da soli. Il sole conta quando è davanti ad almeno una delle pareti (`oreSoleGeom`), così un angolo sud-ovest d'estate prende ~10,6 h invece delle ~7,6 del solo sud. Anche dal connettore (`orient: "S,O"`).
- **Annaffiata / Sotto la pioggia**: 💧 su ogni pianta (anche quando il piano non chiede acqua); 🌧 solo sulle piante al riparo, in veranda/serra o in casa (quelle «fuori, prende la pioggia» la ricevono già nel calcolo). «Sotto la pioggia» chiede **dal giorno e ora al giorno e ora** (anche più giorni, fino a 60 giorni fa; scelte rapide «Stanotte», «Da ieri mattina», «Ultimi 3 giorni», «Ultima settimana»; se «dalle» viene dopo «alle» nello stesso giorno, «dal» passa a ieri) e usa solo la pioggia **misurata** dalla stazione ARPAE più vicina: quarti d'ora o ore degli ultimi 6 giorni (`?op=pioggia`), per i giorni interi più vecchi il totale del giorno scritto dal bot (`pioggiaMisurataTra` nel modello). Registra un evento per giorno con i litri di quel giorno (litri = mm × apertura del vaso), così il bilancio li mette nel giorno giusto; «al» nel futuro conta fino ad adesso; dice fin dove arrivano le misure, quali giorni non conta e se in quei giorni c'era già pioggia registrata. Senza misure non registra niente.
- **Raccolta prevista** (`raccolta` = AAAA-MM, nel modulo o dalla scheda di Claude): le fasi automatiche delle annuali si adattano a quel mese.

## Aspetto
- **Liquid glass** (come l'app Palestra, stile iOS 26): barra delle schede a capsula di vetro sospesa, avvisi e finestre di vetro denso con sfocatura; riquadri e pulsanti con riflesso in alto e bordo di luce; pulsanti principali di vetro colorato; sfondo con due luci tenui. Senza `backdrop-filter` la barra torna piena.
- **Animazioni**: vista e riquadri che entrano al cambio di scheda, giorni del meteo uno dopo l'altro, pulsanti che si abbassano al tocco, livello dell'acqua che si riempie, riquadri che si aprono, avvisi e finestre che entrano. Spente con «Riduci movimento» del telefono.
- **Sfondo che cambia**: in alto la luce della stagione (azzurro d'inverno, rosa in primavera, giallo d'estate, marrone d'autunno, sfumata giorno per giorno; nell'emisfero sud a rovescio), in basso quella dell'ora (alba arancio, verde di giorno, tramonto rosa, blu di notte), con un passaggio lento di 4 secondi (`luce()`, ogni 10 minuti).
- **Animazioni (terzo giro)**: numeri che contano da 0 entrando in una scheda (piante da annaffiare, litri, totali del diario); meteo di oggi dentro il riquadro in alto (pioggia, temporale con lampi, neve, nebbia, nuvola, sole o caldo); schede delle piante che si allargano spostando le altre (iOS 18); finestre con la maniglia da trascinare giù per chiuderle; interruttori che si allungano al tocco e campanella che suona (🔕 quando spegni); giorni del meteo «in arrivo» con un riflesso. Tutte spente con «Riduci movimento».

## Rete e velocità
- **Sincronizzazione a costo quasi zero**: l'app manda la versione che ha (`x-giardino-versione: rev-updatedAt`); se sul server non è cambiato niente risponde `{invariato: true}` (~50 byte invece di tutti i dati) e lo schermo non si ridisegna.
- **Avvio con una richiesta sola**: lo stato di Claude, Telegram e crediti (`/api/dati?op=stato`, una richiesta) si chiede solo quando apri Impostazioni.
- **Meteo con 3 richieste in parallelo** (giornaliero e orario insieme; più modelli; storico del giorno prima, una volta al giorno), lette dalla stessa funzione del modello (`urlMeteo`, `componiMeteo`, `archivioDa`) in app e server; sul server il risultato resta 15 minuti nell'archivio (`c-meteo-<lat>,<lon>`) e lo condividono bot, Claude e Telegram. Il piano dell'app si ricalcola solo se cambia qualcosa che conta.
- **Animazioni che non pesano**: le icone del meteo sono a strati (raggi, nuvola, gocce, fiocchi, lampo, nebbia: ogni parte che si muove è un disegno a sé) e la casella di oggi «respira» con un anello che cambia solo opacità: tutto si muove senza ridisegnare la pagina (con l'app ferma il lavoro del telefono è sceso del 99%).
- **Calcoli più rapidi**: le date si contano come numeri di giorno con una memoria (`numGiorno`, `isoDaNum`: niente oggetti Date nei cicli), i nomi brevi dei giorni si ricordano, la calibrazione non cerca niente per le piante senza controlli e altrimenti prova un fattore ogni tre e poi i vicini; il diario si divide per pianta una volta sola. Piano −40%, calendari −60%.
- **Diario veloce anche lungo**: gli eventi si uniscono (app + Telegram/Claude) una volta sola e si dividono per pianta (`eventiIndice`); l'elenco mostra i 150 più recenti con «Mostra tutti»; cambio di scheda senza ricalcoli forzati della pagina. Con 2400 eventi il Diario si apre in ~40 ms invece di ~300 (telefono simulato).
- **Stessa correzione del consumo ovunque**: app, riepilogo della domenica su Telegram e connettore (registra, diagnosi) usano la stima del bilancio (`calibrazioneVera`).
- **Storico una volta sola sul telefono**: il meteo salvato non ripete storico e archivio (stanno solo in `storico`).
- **ARPAE**: le righe delle stazioni lontane si scartano leggendo solo le coordinate (4 volte più rapido).
- **Prove**: `npm test` rigenera prima la pagina (`pretest`), così pagina e impronta della versione sono sempre aggiornate.
- **Schede al tocco**: la barra in basso cambia scheda già al tocco (anche mentre la pagina scorre per inerzia o c'è un'animazione: su iPhone quel tocco non diventa un «click»).
- **Ridisegno solo della vista aperta**; gli aggiornamenti arrivati da soli si raggruppano in un ridisegno per fotogramma (e nessuno con l'app in background).
- **Bot**: se oggi mattino e sera sono già fatti, non legge niente fino al giorno dopo.
- **Apertura istantanea** (`sw.js`): pagina e icone arrivano subito dalla copia salvata sul telefono, anche con rete lenta o assente (con 2 s di rete lenta: ~40 ms invece di ~2 s); intanto la pagina del sito si scarica in sottofondo e aggiorna la copia. Se è una versione nuova (impronta `giardino-build` scritta da `build-app.mjs`) l'app si ricarica: subito se è appena aperta (meno di 3 s) e non l'hai toccata, altrimenti al ritorno sull'app, mai con una finestra aperta o un campo in scrittura, al massimo una volta al minuto. Dati (`/api`) e connettore (`/mcp`) non passano mai dalla copia.
- **Risposte compresse**: le risposte grandi di `/api/dati` (tutti i dati, a ogni salvataggio e a ogni controllo con novità) arrivano in gzip, circa un decimo dei byte (Netlify non comprime da solo le risposte delle funzioni). Se una risposta non arriva o non si legge, l'app riprova subito in chiaro (`x-giardino-gzip: no`); se la colpa è della compressione (risposta illeggibile, o due errori di fila: un attimo senza rete non conta) per una settimana le chiede così. Una risposta «ok» senza dati non vale mai (non cancella quelli sul telefono).
- **Prove della rete vera** (`test/sw.test.mjs`): server su localhost e Chromium: apertura dalla copia, versioni nuove, senza rete, compressione e ripiego in chiaro.

## Come si calcola (vasi)

- Acqua disponibile = 25% del volume del vaso, ridotta del 6% per ogni pianta in più (radici), minimo 60%.
- Chioma: quella tipica della specie (o la superficie indicata); in vaso al massimo 4 × la superficie del vaso (chioma larga circa il doppio del vaso).
- Si innaffia quando è consumata la quota che regge la pianta più delicata del vaso.
- Consumo giornaliero (L) = ET₀ × (Σ Kc × chioma + 0,15 × superficie del terriccio) × fattore luce × correzione appresa.
  Fattore luce = 0,35 + 0,65 × ore/8 (fino a 9 h).
- In casa ET₀ = 0,8 × eₛ(T)/eₛ(20) + 0,15 × ore di luce × PT(T)/PT(20): eₛ = pressione di vapore saturo (aria più calda, più secca),
  PT = fattore di Priestley-Taylor Δ/(Δ+γ). T = temperatura della stanza indicata per stagione (tipica: inverno 20, primavera 21,
  estate 26, autunno 21 °C), interpolata giorno per giorno tra metà gennaio, aprile, luglio e ottobre. A 20 °C vale 0,8 + 0,15 × ore.
- Correzione appresa (ultimi 60 giorni, tra 0,4 e 2,5): "era ancora umida" −10%, "era secca" +12%; la stessa risposta di fila
  corregge di più (2ª volta −15% / +18%, dalla 3ª −20% / +24%), una risposta opposta riparte da capo.
- Vaso: terracotta +25% (perde acqua dalle pareti); senza fori = dose esatta e avviso dopo la pioggia; sottovaso con riserva:
  i suoi litri si aggiungono all'acqua disponibile. All'aperto, effetto vaso: con 30 °C o più +15% (vasi fino a 10 L al sole)
  o +7%, con vento da 30 km/h +10% o +5%.
- Pioggia prevista pesata con la probabilità (piena dall'80%). Veranda/serra: niente pioggia, temperature per stagione,
  parte del sole doppia rispetto alla casa, gelo solo sotto la soglia meno 4 °C.
- Piena terra all'aperto: se nessuno ha innaffiato negli ultimi 3 giorni, il punto di partenza è l'umidità reale del suolo
  (Open-Meteo, 0–27 cm; capacità di campo 0,32, appassimento 0,12 m³/m³).
- Pioggia utile nel vaso = (pioggia − 1,5 mm) × superficie del vaso × 0,8; zero se riparato o in casa.
- Dose = acqua consumata + 10%, cioè finché esce un po' dal foro.
- Semi in germinazione (annuali seminate, non aglio, patate, fagioli, piselli): stanno nel primo centimetro, che si asciuga prima del vaso. Si conta l'ET₀ dall'ultima volta che la superficie si è bagnata (pioggia da 2 mm, innaffiatura, «era umida» o controllo umido); oltre 4 mm l'app chiede una bagnatura leggera (~3 mm sulla superficie del vaso: 0,6 L su un vaso da 50 cm), anche se il vaso è ancora pieno.

## Crediti Netlify (piano Free: 300 al mese)

Ogni pubblicazione costa 15 crediti: si pubblica solo se cambia la cartella `giardino-netlify` (regola `ignore` in `netlify.toml`).
`build-app.mjs` scrive un'impronta della versione (`netlify/lib/versione.mjs`); il bot conta le impronte nuove del mese, l'app
mostra la stima in Impostazioni → Crediti Netlify e Telegram avvisa all'80%. Il conto esatto è su app.netlify.com → Usage.
Uso normale (app, bot ogni ora, Claude): 10-20 crediti al mese misurati, nella stima 15.
