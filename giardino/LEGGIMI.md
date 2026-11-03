# Giardino — promemoria di innaffiatura su Telegram

Ogni giorno alle 05:17 UTC (06:17 ora solare, 07:17 ora legale) il workflow
`.github/workflows/giardino-notifiche.yml` esegue `notifica.mjs`:

1. legge posizione e piante da `piante.json`;
2. scarica il meteo reale da Open-Meteo (3 giorni passati + 7 di previsione, con ET₀ FAO-56);
3. calcola il bilancio idrico di ogni pianta (e, se c'è `ANTHROPIC_API_KEY`, lo fa rifinire a Claude);
4. se oggi c'è da innaffiare o controllare, invia un messaggio Telegram;
5. registra in `stato.json` le innaffiature notificate (si assume che tu le abbia fatte).

## Configurazione (una volta)

1. Telegram → **@BotFather** → `/newbot` → copia il **token**. Apri il bot e premi **Avvia**.
2. GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**:
   - `TELEGRAM_BOT_TOKEN` = token del bot
3. Actions → "Giardino - notifiche innaffiatura" → **Run workflow**. Il job fallisce di proposito
   e nel registro stampa l'id della tua chat: crea il secret `TELEGRAM_CHAT_ID` con quel numero.
4. Run workflow di nuovo: arriva il primo messaggio.
5. Facoltativo: secret `ANTHROPIC_API_KEY` (piano rifinito da Claude); variabile `CLAUDE_MODEL`
   (default `claude-opus-5-5`).

Il workflow pianificato parte solo dal branch principale (`main`).

## Piante

Modifica `piante.json` (oppure copia il testo dalla scheda Telegram dell'app Giardino).
Campi di ogni pianta: `specie` (pomodoro, zucchina, peperone, melanzana, lattuga, fagiolo, fragola,
basilico, prezzemolo, rosmarino, lavanda, agrumi, olivo, rosa, ortensia, geranio, prato, succulenta,
appartamento, altro), `fase` (germinazione, piantina, vegetativa, fioritura, fruttificazione,
maturazione, riposo), `colt` (vaso, terra, rialzata), `vaso` in litri, `area` in m² (facoltativa),
`num`, `espo` (sole, mezzombra, ombra), `dove` (aperto, riparato, interno), `ultima` (AAAA-MM-GG).
