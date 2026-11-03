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
| Claude | `netlify/functions/mcp.mjs` → `/mcp/<chiave>` | connettore MCP: `giardino`, `diario`, `salva_piano`, `registra`, `modifica_pianta`, `vacanza` |
| Telegram | `netlify/functions/telegram.mjs` (webhook) + `bot.mjs` (ogni ora) | pulsanti **Annaffiato** / **Terreno ancora umido** (al mattino anche Salto); comandi /oggi /fatto [zona] /settimana /vacanza /aiuto; piano del mattino; la sera promemoria di ciò che manca e avvisi (gelo ora per ora, caldo, vento); riepilogo la domenica; backup come file ogni mese |
| Siri | `netlify/functions/siri.mjs` → `/api/siri/oggi` e `/api/siri/fatto[?zona=…]` | Comandi Rapidi “Ho innaffiato” e “Cosa innaffio oggi”: risposta in testo da far leggere a Siri; codice nell'intestazione `x-giardino-code` |
| Prove | `giardino-netlify/test/`, `.github/workflows/giardino-test.yml` | a ogni modifica su GitHub: pagina ricostruita dai sorgenti, modello, funzioni del sito, interfaccia nel browser da 320 a 430 px |

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

## Come si calcola (vasi)

- Acqua disponibile = 25% del volume del vaso, ridotta del 6% per ogni pianta in più (radici), minimo 60%.
- Chioma: quella tipica della specie (o la superficie indicata); in vaso al massimo 4 × la superficie del vaso (chioma larga circa il doppio del vaso).
- Si innaffia quando è consumata la quota che regge la pianta più delicata del vaso.
- Consumo giornaliero (L) = ET₀ × (Σ Kc × chioma + 0,15 × superficie del terriccio) × fattore luce × correzione appresa.
  Fattore luce = 0,35 + 0,65 × ore/8 (fino a 9 h).
- In casa ET₀ = 0,8 × eₛ(T)/eₛ(20) + 0,15 × ore di luce × PT(T)/PT(20): eₛ = pressione di vapore saturo (aria più calda, più secca),
  PT = fattore di Priestley-Taylor Δ/(Δ+γ). T = temperatura della stanza indicata per stagione (tipica: inverno 20, primavera 21,
  estate 26, autunno 21 °C), interpolata giorno per giorno tra metà gennaio, aprile, luglio e ottobre. A 20 °C vale 0,8 + 0,15 × ore.
- Correzione appresa: −10% per ogni "era ancora umida", +12% per ogni "era secca" (ultimi 60 giorni, tra 0,5 e 2).
- Piena terra all'aperto: se nessuno ha innaffiato negli ultimi 3 giorni, il punto di partenza è l'umidità reale del suolo
  (Open-Meteo, 0–27 cm; capacità di campo 0,32, appassimento 0,12 m³/m³).
- Pioggia utile nel vaso = (pioggia − 1,5 mm) × superficie del vaso × 0,8; zero se riparato o in casa.
- Dose = acqua consumata + 10%, cioè finché esce un po' dal foro.
