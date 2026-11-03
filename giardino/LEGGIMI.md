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
| Dati | `netlify/functions/dati.mjs` → Netlify Blobs | salvataggio con codice di sincronizzazione; chiave per Claude; collegamento del bot |
| Claude | `netlify/functions/mcp.mjs` → `/mcp/<chiave>` | connettore MCP: `giardino`, `diario`, `salva_piano`, `registra`, `modifica_pianta`, `vacanza` |
| Telegram | `netlify/functions/telegram.mjs` (webhook) + `bot.mjs` (ogni ora) | pulsanti istantanei; comandi /oggi /fatto /settimana /vacanza /aiuto; piano del mattino; la sera promemoria di ciò che manca e avvisi (gelo ora per ora, caldo, vento); riepilogo la domenica; backup come file ogni mese |

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

## Modifiche al codice

Modifica `giardino/app.src.html`, `giardino/modello.mjs` o `giardino/netlify-shim.js`, poi `node giardino/build-app.mjs`
e push su `main`. Nessuna chiave API a pagamento: Claude lavora solo attraverso il connettore.
Il branch `giardino-dati` (dati del vecchio bot su GitHub) non serve più e si può eliminare.

## Come si calcola (vasi)

- Acqua disponibile = 25% del volume del vaso, ridotta del 6% per ogni pianta in più (radici), minimo 60%.
- Si innaffia quando è consumata la quota che regge la pianta più delicata del vaso.
- Consumo giornaliero (L) = ET₀ × (Σ Kc × chioma + 0,15 × superficie del terriccio) × fattore luce × correzione appresa.
  Fattore luce = 0,35 + 0,65 × ore/8 (fino a 9 h). In casa ET₀ = 0,8 + 0,15 × ore di luce.
- Correzione appresa: −10% per ogni "era ancora umida", +12% per ogni "era secca" (ultimi 60 giorni, tra 0,5 e 2).
- Piena terra all'aperto: se nessuno ha innaffiato negli ultimi 3 giorni, il punto di partenza è l'umidità reale del suolo
  (Open-Meteo, 0–27 cm; capacità di campo 0,32, appassimento 0,12 m³/m³).
- Pioggia utile nel vaso = (pioggia − 1,5 mm) × superficie del vaso × 0,8; zero se riparato o in casa.
- Dose = acqua consumata + 10%, cioè finché esce un po' dal foro.
