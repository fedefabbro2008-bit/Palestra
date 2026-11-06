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
| Siri | `netlify/functions/siri.mjs` → `/api/siri/oggi` e `/api/siri/fatto[?zona=…]` | Comandi Rapidi “Ho innaffiato” e “Cosa innaffio oggi”: risposta in testo da far leggere a Siri; codice nell'intestazione `x-giardino-code` |
| Prove | `giardino-netlify/test/`, `.github/workflows/giardino-test.yml` | a ogni modifica su GitHub: pagina ricostruita dai sorgenti, modello, funzioni del sito, interfaccia nel browser da 320 a 430 px |
| Sito online | `giardino-netlify/test/sito-online.mjs`, `.github/workflows/giardino-sito.yml` | dopo ogni modifica su main (aspetta fino a 12 min la pubblicazione) e ogni mattina: versione online = commit, pagina, manifest, dati, connettore, Siri, webhook Telegram. Se fallisce GitHub manda l'email. Facoltativi nei segreti del repository (Settings → Secrets and variables → Actions): `GIARDINO_CODE` e `GIARDINO_MCP` per provare anche i dati veri, solo in lettura |

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
5. Facoltativo: Impostazioni → **Siri e Comandi Rapidi** per dire “Ehi Siri, ho innaffiato”.

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
- **Meteo dei primi giorni da due modelli**: per oggi, domani e dopodomani (solo i giorni che ICON-2I copre per intero, ora per ora) pioggia, massima e minima sono la media tra il modello di Open-Meteo e **ICON-2I** di ItaliaMeteo-ARPAE (2,2 km). Fuori dall'Italia resta il primo.
- **Specie riconosciuta dal nome** («Nepenthes mirabilis» → Nepenthes, «Pomodori ciliegini» → Pomodoro): nuova pianta = scelta da sola; pianta come «Altra pianta» = proposta nella scheda.
- **Scheda dell'app** per ogni specie: descrizione, condizioni ideali, stagioni (perenni) o fasi settimana per settimana (annuali), calendario dei mesi, consigli della specie + consigli dai dati della pianta (vaso, luce, posto). La scheda di Claude, se c'è, la sostituisce.
- **Diagnosi guidata** (Scheda → Come sta?): sintomi da spuntare → troppa o poca acqua (registra «meno»/«più» e il calcolo impara) o altre cause (calcare, ferro, luce, oidio, ragnetto, scottature).
- **Sintesi della settimana e prossima innaffiatura** per pianta anche nel calcolo automatico (app, Telegram /settimana, connettore).

## Precisione e riserve (senza Claude)
- **Sole secondo la stagione**: con «Verso dove guarda» (bussola nella scheda della pianta) le ore di sole scritte valgono per quel giorno (`luce_data`) e cambiano da sole con le stagioni (geometria del sole, `oreSoleGeom`). In casa e in veranda la luce del giorno segue anche il sole previsto (`sunshine_duration`).
- **Fasi a gradi-giorno**: le annuali con la data di semina avanzano con le temperature vere (storico di Open-Meteo, 400 giorni, una richiesta al giorno), poi con le previsioni e la stessa settimana dell'anno prima (`GRADI`, `etaEquivalente`).
- **Controllo della settimana**: sabato e domenica, una pianta da toccare con il dito (app e Telegram il sabato); la risposta si confronta con l'acqua calcolata e il calcolo impara (`verificaDaFare`, `esitoVerifica`).
- **Meteo di riserva**: se Open-Meteo non risponde, MET Norway dal server (giorni passati dall'ultimo meteo buono); l'app lo chiede al server (`?op=meteo`).
- **Pioggia misurata**: ogni 3 ore il bot legge le stazioni ARPAE-SIMC (open data, solo Emilia-Romagna) e scrive nei dati i giorni completi della stazione più vicina (`pioggia_misurata`): nei giorni passati prende il posto della pioggia stimata.
- **Bot di riserva su GitHub** (`giardino/riserva.mjs`, `.github/workflows/giardino-riserva.yml`, ogni mattina): sito vivo → copia cifrata dei dati nella cache di GitHub Actions; sito fermo (es. crediti finiti) → messaggio del mattino su Telegram da GitHub. Segreti: `GIARDINO_CODE`, `GIARDINO_TG_TOKEN`, `GIARDINO_TG_CHAT` (il numero è in Impostazioni → Telegram).
- **Crediti**: in Impostazioni → Crediti Netlify si scrive il valore vero letto su Netlify e la stima riparte da lì.
- **Badge «Powered by Netlify»** (piano gratuito): l'app gli lascia una fascia al centro sotto le schede.

## Rete e velocità
- **Sincronizzazione a costo quasi zero**: l'app manda la versione che ha (`x-giardino-versione: rev-updatedAt`); se sul server non è cambiato niente risponde `{invariato: true}` (~50 byte invece di tutti i dati) e lo schermo non si ridisegna.
- **Avvio con una richiesta sola**: lo stato di Claude, Telegram e crediti (`/api/dati?op=stato`, una richiesta) si chiede solo quando apri Impostazioni.
- **Meteo con 2 richieste in parallelo** (giornaliero e orario insieme + ICON-2I), lette dalla stessa funzione del modello (`urlMeteo`, `componiMeteo`) in app e server; sul server il risultato resta 15 minuti nell'archivio (`c-meteo-<lat>,<lon>`) e lo condividono bot, Claude, Telegram e Siri.
- **Ridisegno solo della vista aperta**; gli aggiornamenti arrivati da soli si raggruppano in un ridisegno per fotogramma (e nessuno con l'app in background).
- **Bot**: se oggi mattino e sera sono già fatti, non legge niente fino al giorno dopo.
- **Service worker**: prima la rete; se non risponde entro 3 secondi, la copia salvata.

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

## Crediti Netlify (piano Free: 300 al mese)

Ogni pubblicazione costa 15 crediti: si pubblica solo se cambia la cartella `giardino-netlify` (regola `ignore` in `netlify.toml`).
`build-app.mjs` scrive un'impronta della versione (`netlify/lib/versione.mjs`); il bot conta le impronte nuove del mese, l'app
mostra la stima in Impostazioni → Crediti Netlify e Telegram avvisa all'80%. Il conto esatto è su app.netlify.com → Usage.
