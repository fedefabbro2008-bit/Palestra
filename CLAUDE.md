# Palestra — regole per chi modifica il codice

App personale per la palestra: una PWA in un file solo (`index.html`) con le funzioni di Netlify in `netlify/`.
L'utente carica a mano lo zip su Netlify: ogni pubblicazione costa crediti. Non pubblicare se non te lo chiede.

## Prove (obbligatorie)

Le prove stanno in `tests/` e si lanciano con un comando solo:

```
node tests/run.mjs            # tutte
node tests/run.mjs barra      # solo quelle col nome che contiene "barra"
```

Servono Node 22+, Playwright con Chromium e, per le prove del connettore, `npm install` dentro `tests/`.
Il server di prova (`tests/server/`) usa le funzioni **vere** di `netlify/functions` con un archivio e un Telegram finti:
non serve copiarle.

Regole:

1. **Prima di consegnare una modifica fai girare tutte le prove.** Consegna solo se passano.
2. Se una prova fallisce **perché il comportamento è cambiato su richiesta dell'utente**, aggiorna la prova alla regola
   nuova (e dillo nel riepilogo). Se fallisce per qualcosa che l'utente non ha chiesto di cambiare, **correggi il codice,
   non la prova**.
3. **Ogni funzione nuova arriva con la sua prova** (un file in `tests/ui/` o `tests/mcp/`, con una riga in
   `tests/elenco.mjs`).
4. Non cancellare, non saltare e non indebolire una prova per farla passare.
5. Nelle prove niente dati personali: usa `tests/ui/seed.js` e `tests/ui/prepara-dati.js` (dati di prova
   generati ogni volta). Mai un backup vero nel progetto.

## Come è fatta l'app

- `index.html`: HTML, stile e script in un file (tutto dentro una funzione). Le variabili lette all'avvio prima della
  loro dichiarazione sono `var`, non `let`/`const`.
- Dati nel telefono: chiavi `palestra:*` in localStorage; la copia automatica in IndexedDB.
- `allSessions()` (copia) e `allSessionsList()` (da leggere soltanto) ricordano l'elenco degli allenamenti e lo
  ricontrollano a ogni chiamata; sopra c'è l'indice per esercizio `exLookup()` (entriesOf, findPrevEntry, knownWeights,
  stallInfo), che si rifà quando cambia l'elenco o `dataVersion`. Se cambi una voce di un allenamento già salvato
  (nome, id, serie), salvala con `persist('logs')` prima di leggere o ridisegnare.
- `dataVersion` cresce solo se cambiano i dati: salvare le impostazioni cambiando solo la giornata scelta (`lastDay`) o
  la data dell'ultimo export non lo fa crescere (`settingsSig`), così toccare una giornata non rifà indice, durate
  previste e statistiche. `window.__conta` conta i ricalcoli pesanti per le prove (`ricalcoli-evitati`).
- In allenamento il menu ⋯ di un esercizio (tendine di muscoli e tipo, sposta, superset) si crea solo quando è aperto
  (`sessMetaOpen`): le prove che lo usano devono aprirlo prima.
- `fonts/`: i caratteri (nome con l'impronta del contenuto: un carattere nuovo ha un nome nuovo). `sw.js` li salva
  all'installazione e li serve dalla copia.
- `sw.js`: la pagina si apre sempre dalla copia salvata (subito, anche con rete lentissima); in sottofondo chiede al
  server se la versione pubblicata è cambiata (`If-None-Match` con l'impronta della copia: se no, 304 senza contenuto)
  e, se è cambiata, la scarica e la pagina mostra «Aggiorna» (mai durante un allenamento). Le richieste al
  server passano da `fetchT` (tempo massimo) e la sincronizzazione riprova da sola (`syncRetry`).
- `netlify/functions/sync.mjs`: sincronizzazione (unione a tre con versione ed etag), chiave del connettore, Telegram.
- `netlify/functions/mcp.mjs`: connettore per Claude (lettura; scheda e storico solo con i permessi accesi nell'app).
  Letture in più: `analisi_scheda`, `confronta_periodi`, `cerca_note`, `esporta` (CSV come quello dell'app, a giorni
  interi) e `progressione_suggerita`, che usa le stesse regole dell'app (`progressionHint`, `hintFor`): se cambi i consigli
  nell'app, cambiali anche lì (la prova `claude-letture-uguali` li confronta).
  Scheda (`modifica_scheda`): come «Nuova giornata» nell'app, una giornata nuova si salva solo con i suoi esercizi e un
  esercizio già nella scheda o nello storico, dato per nome, parte dai suoi valori e dai kg dell'ultima volta (`ndExFrom`).
  Storico: `correggi_storico`, `sposta_storico`, `elimina_storico_esercizio`, `registra_allenamento` (solo date passate,
  forma compatta dell'app; nell'annullo `before.session = null`), tutto o niente su una copia, e
  `annulla_correzione_storico` (pila delle ultime 10 modifiche, in chiave `h-`). Il segno `claudeLog` tiene anche le
  ultime modifiche (`items`): l'app mostra insieme tutte quelle non ancora viste e «Rimetti com'era» le annulla tutte.
- `netlify/functions/telegram-backup.mjs` + `netlify/lib/telegram.mjs`: backup su Telegram il 1° e il 16 del mese.

## Stile

- Testi dell'interfaccia e commenti in italiano semplice.
- Le animazioni rispettano «Riduci movimento», le animazioni spente e il risparmio energetico (`motionOK()`).
- Animazioni continue solo con `transform` e `opacity`.
- Leggerezza (controllata dalla prova `leggerezza`):
  - a riposo la pagina è ferma: niente animazioni che girano a vuoto (es. l'anello del timer solo a finestra aperta);
  - le animazioni che partono a ogni tocco usano solo `transform` e `opacity` (un velo che si accende, non il colore
    di sfondo; una barra che scorre, non la larghezza);
  - mai variabili CSS scritte sulla radice durante l'uso (ricalcolano tutta la pagina): sull'elemento che le usa,
    registrate non ereditate con `@property` (es. `--stack-h` su `main`);
  - niente `:has()` su `html` o `body`: una classe messa da JS.
- Lo zip per Netlify contiene `index.html`, `sw.js`, `fonts/`, `netlify.toml`, `package.json`, `netlify/` (non `tests/`).
