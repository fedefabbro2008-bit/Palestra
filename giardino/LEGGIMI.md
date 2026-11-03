# Giardino

Piano di innaffiatura personalizzato (specie, fase di crescita, vaso, luce, zona, meteo) con promemoria su Telegram.
**Funziona senza abbonamento Claude**: Claude si usa via API (Claude Haiku 5.5, effort alto), pagando solo l'uso.

## Pezzi

| Pezzo | Dove | Cosa fa |
|---|---|---|
| **App** | https://fedefabbro2008-bit.github.io/Palestra/giardino/ (GitHub Pages, file `index.html`) | piante, piano, diario, vacanza, diagnosi da foto, backup. Meteo diretto da Open-Meteo. |
| **Modello** | `modello.mjs` | bilancio idrico in litri, condiviso da app e bot |
| **Bot** | `notifica.mjs` + `.github/workflows/giardino-notifiche.yml` (ogni 15 min) | legge i pulsanti Telegram; dalle 7 manda il piano se c'è da fare; dalle 19 avvisa di gelo, caldo, vento |
| **Dati** | branch `giardino-dati` | `app.json` (dati completi dell'app), `piante.json` + `eventi.json` (per il bot), `stato.json` + `per-app.json` (scritti dal bot) |

L'app salva su GitHub a ogni modifica (un commit sul branch dei dati) e il bot li usa al giro successivo.
"Aggiorna ora" avvia il bot in modalità `aggiorna` e riporta nell'app piano e risposte di Telegram.

## Configurazione (una volta)

**App** (scheda Impostazioni → Collegamenti; le chiavi restano solo nel browser):
1. Chiave API Anthropic: console.anthropic.com → API Keys (serve un piccolo credito prepagato).
2. Token GitHub fine-grained: github.com/settings/personal-access-tokens/new → solo il repo Palestra →
   permessi **Contents** e **Actions** in lettura e scrittura.

**Telegram**:
1. @BotFather → `/newbot` → copia il token. Apri il bot e premi Avvia.
2. Repo → Settings → Secrets and variables → Actions: secret `TELEGRAM_BOT_TOKEN`.
3. Actions → "Giardino - notifiche innaffiatura" → Run workflow (`prova`): nel registro trovi l'id della chat →
   secret `TELEGRAM_CHAT_ID` → di nuovo Run workflow.
4. Facoltativo: secret `ANTHROPIC_API_KEY` perché anche il bot faccia rifinire il piano a Claude
   (`CLAUDE_MODEL` default `claude-haiku-5-5`, `CLAUDE_EFFORT` default `high`, come variabili del repo).

## Backup

Impostazioni → Backup → "Scarica il backup" crea `giardino-backup-AAAA-MM-GG.json` (posizione, piante, impostazioni,
diario, piano; senza chiavi). Nella nuova versione o su un altro dispositivo: "Importa un backup".

## Costi

- GitHub Actions, GitHub Pages, Telegram, Open-Meteo: gratis.
- Claude Haiku 5.5 via API: $0,10 / $0,50 per milione di token in ingresso / uscita. Un piano costa
  indicativamente meno di 1 centesimo; la diagnosi da foto un paio di millesimi.

## Modifiche al codice

Modifica `app.src.html`, `modello.mjs` o `standalone.js`, poi `node giardino/build-app.mjs` e fai push su main:
GitHub Pages pubblica `giardino/index.html` in automatico. (`giardino-app.html` è la vecchia versione per claude.ai.)

## Come si calcola (vasi)

- Acqua disponibile = 25% del volume del vaso, ridotta del 6% per ogni pianta in più (radici), minimo 60%.
- Si innaffia quando è consumata la quota che regge la pianta più delicata del vaso.
- Consumo giornaliero (L) = ET₀ × (Σ Kc × chioma + 0,15 × superficie del terriccio) × fattore luce × correzione appresa.
  Fattore luce = 0,35 + 0,65 × ore/8 (fino a 9 h). In casa ET₀ = 0,8 + 0,15 × ore di luce.
- Correzione appresa: −10% per ogni "era ancora umida", +12% per ogni "era secca" (ultimi 60 giorni, tra 0,5 e 2).
- Pioggia utile nel vaso = (pioggia − 1,5 mm) × superficie del vaso × 0,8; zero se riparato o in casa.
- Dose = acqua consumata + 10%, cioè finché esce un po' dal foro.
