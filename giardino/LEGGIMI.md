# Giardino

Piano di innaffiatura personalizzato (specie, fase di crescita, vaso, luce, zona, meteo) con app su claude.ai
e promemoria su Telegram.

## Come funziona

| Pezzo | Dove | Cosa fa |
|---|---|---|
| **App** | artifact `https://claude.ai/artifact/16YMCT8C97DJJQMWC7aaVw` (sorgente `app.src.html`, build `giardino-app.html`) | piante, piano, diario, vacanza, diagnosi da foto; il piano lo genera Claude dal tuo account |
| **Modello** | `modello.mjs` | bilancio idrico in litri, condiviso da app e bot (fasi automatiche, calibrazione, concime, rinvaso, dosi, avvisi) |
| **Bot** | `notifica.mjs` + `.github/workflows/giardino-notifiche.yml` (ogni 15 min) | legge i pulsanti Telegram; dalle 7 manda il piano del giorno se c'è da fare; dalle 19 avvisa di gelo, caldo, vento per domani |
| **Sincronizzazione** | attività pianificata di Claude, ogni giorno alle 06:37 (e dal pulsante "Sincronizza ora" dell'app) | porta le piante dall'app a `piante.json`/`eventi.json`, avvia il bot in modalità `aggiorna`, riporta nell'app meteo reale, piano e pulsanti premuti (`per-app.json`) |

File scritti dal bot: `stato.json` (memoria: offset Telegram, eventi, ultimo piano) e `per-app.json` (dati per l'app).
Se non premi nessun pulsante, il giorno dopo il bot considera fatte le innaffiature notificate.

## Configurazione di Telegram (una volta)

1. Telegram → **@BotFather** → `/newbot` → copia il **token**. Apri il bot e premi **Avvia**.
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret**: `TELEGRAM_BOT_TOKEN`.
3. Actions → "Giardino - notifiche innaffiatura" → **Run workflow** (modo `prova`). Il job fallisce di proposito
   e nel registro stampa l'id della tua chat: crea il secret `TELEGRAM_CHAT_ID` con quel numero.
4. Run workflow di nuovo (`prova`): arriva il primo messaggio.
5. Facoltativo: secret `ANTHROPIC_API_KEY` per far rifinire a Claude anche il piano del bot; variabile `CLAUDE_MODEL`.

Finché i secret mancano, il bot non manda nulla ma la modalità `aggiorna` porta comunque meteo e piano nell'app.

## Modifiche

- App: modifica `app.src.html` o `modello.mjs`, poi `node giardino/build-app.mjs trig_01LQKQB7vmmYWJt9BcYnua6S`
  e ripubblica `giardino-app.html` sullo stesso artifact.
- Bot: `notifica.mjs` usa direttamente `modello.mjs`.

## Come si calcola (vasi)

- Acqua disponibile = 25% del volume del vaso, ridotta del 6% per ogni pianta in più (radici), minimo 60%.
- Si innaffia quando è consumata la quota che regge la pianta più delicata del vaso.
- Consumo giornaliero (L) = ET₀ × (Σ Kc × chioma di ogni pianta + 0,15 × superficie del terriccio) × fattore luce × correzione appresa.
  Fattore luce = 0,35 + 0,65 × ore/8 (fino a 9 h). In casa ET₀ = 0,8 + 0,15 × ore di luce.
- Correzione appresa: −10% per ogni "era ancora umida", +12% per ogni "era secca" (ultimi 60 giorni, tra 0,5 e 2).
- Pioggia utile nel vaso = (pioggia − 1,5 mm) × superficie del vaso × 0,8; zero se riparato o in casa.
- Dose = acqua consumata + 10%, cioè finché esce un po' dal foro.
