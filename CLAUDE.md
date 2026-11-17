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
- `fonts/`: i caratteri (nome con l'impronta del contenuto: un carattere nuovo ha un nome nuovo). `sw.js` li salva
  all'installazione e li serve dalla copia.
- `sw.js`: la pagina si apre sempre dalla copia salvata (subito, anche con rete lentissima); la versione pubblicata si
  scarica in sottofondo e, se è cambiata, la pagina mostra «Aggiorna» (mai durante un allenamento). Le richieste al
  server passano da `fetchT` (tempo massimo) e la sincronizzazione riprova da sola (`syncRetry`).
- `netlify/functions/sync.mjs`: sincronizzazione (unione a tre con versione ed etag), chiave del connettore, Telegram.
- `netlify/functions/mcp.mjs`: connettore per Claude (lettura; scheda e storico solo con i permessi accesi nell'app).
  Storico: `correggi_storico`, `sposta_storico`, `elimina_storico_esercizio` (tutto o niente, su una copia) e
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
