/* Elenco delle prove, nell'ordine in cui girano. Per aggiungerne una: il file in ui/ (o mcp/) e una riga qui.
   args(c): argomenti da passare (c.dir = cartella per foto e file della prova, c.fixture = dati di prova, c.code = codice
   di sincronizzazione già pronto se serveCodice). Senza args la prova riceve solo c.dir. */
const F = c => [c.fixture], DF = c => [c.dir, c.fixture], FD = c => [c.fixture, c.dir];
export const TESTS = [
  // avvio, schermate, aspetto
  { nome: 'avvio-vuota-e-con-dati', file: 'ui/avvio-vuota-e-con-dati.test.js', cosa: 'prima apertura e con storico, tutte le sezioni' },
  { nome: 'schermate-temi', file: 'ui/schermate-temi.test.js', cosa: 'giro delle schermate, tema chiaro, risparmio, 320 px, Android' },
  { nome: 'schermo-stretto-rpe', file: 'ui/schermo-stretto-rpe.test.js', cosa: '320 px con RPE: nomi non tagliati' },
  { nome: 'barra-allenamento-larghezze', file: 'ui/barra-allenamento-larghezze.test.js', cosa: 'titolo dell\'allenamento a 320/390/430 px' },
  { nome: 'campo-sopra-barra', file: 'ui/campo-sopra-barra.test.js', cosa: 'tastiera e tocco: il campo non finisce sotto la barra' },
  { nome: 'campo-sopra-timer', file: 'ui/campo-sopra-timer.test.js', cosa: 'campo in basso con il timer aperto' },
  // allenamento
  { nome: 'rotazione-riserve', file: 'ui/rotazione-riserve.test.js', cosa: 'giornata che tocca, riserve, dopo Termina e riavvio' },
  { nome: 'allenamento-strumenti', file: 'ui/allenamento-strumenti.test.js', cosa: 'consiglio, drop set, avvicinamento, sostituisci, recupero, termina' },
  { nome: 'allenamento-sposta-superset', file: 'ui/allenamento-sposta-superset.test.js', cosa: 'sposta, superset, aggiungi, allenamento libero, fine = ultima spunta' },
  { nome: 'serie-successiva', file: 'ui/serie-successiva.test.js', cosa: 'la serie illuminata va sempre avanti' },
  { nome: 'ridisegno-parziale', file: 'ui/ridisegno-parziale.test.js', cosa: 'gli esercizi non toccati non si ridisegnano' },
  { nome: 'per-lato', file: 'ui/per-lato.test.js', cosa: 'esercizi per lato: scheda, allenamento, peso, correggi' },
  { nome: 'per-lato-nel-nome', file: 'ui/per-lato-nel-nome.test.js', cosa: '«(per lato)» nel nome' },
  { nome: 'sostituisci-ricerca', file: 'ui/sostituisci-ricerca.test.js', cosa: 'Sostituisci: gruppi, ricerca, nome nuovo' },
  { nome: 'sostituisci-schermi', file: 'ui/sostituisci-schermi.test.js', cosa: 'Sostituisci a 390 scuro e 320 chiaro' },
  { nome: 'sostituisci-ricerca-in-vista', file: 'ui/sostituisci-ricerca-in-vista.test.js', cosa: 'primo risultato in vista' },
  { nome: 'timer-riapertura', file: 'ui/timer-riapertura.test.js', cosa: 'recupero salvato alla riapertura' },
  { nome: 'casi-limite-scheda', file: 'ui/casi-limite-scheda.test.js', cosa: 'allenamento lasciato aperto, ultima giornata, riprendi' },
  { nome: 'riordino-trascinando', file: 'ui/riordino-trascinando.test.js', cosa: 'spostare esercizi trascinando (mouse e dito)' },
  // barra, animazioni
  { nome: 'barra-lente', file: 'ui/barra-lente.test.js', cosa: 'lente della barra: scivola, va oltre, un tocco = un cambio' },
  { nome: 'barra-trascinamento', file: 'ui/barra-trascinamento.test.js', cosa: 'lente afferrata: segue il dito, si allunga, rilascio' },
  { nome: 'animazioni', file: 'ui/animazioni.test.js', cosa: 'timer, serie dopo, interruttori, giornate, numeri, riquadri, fiammella' },
  // statistiche
  { nome: 'muscoli-corpo-costanza', file: 'ui/muscoli-corpo-costanza.test.js', args: DF, cosa: 'Serie per muscolo con il corpo, costanza 6 mesi' },
  { nome: 'avambracci', file: 'ui/avambracci.test.js', args: FD, cosa: 'avambracci: figura, statistiche, nomi' },
  { nome: 'peso-per-giornata', file: 'ui/peso-per-giornata.test.js', args: FD, cosa: 'Peso totale per giornata: riserve, sedute escluse' },
  // dati: backup, import, sicurezza, memoria
  { nome: 'senza-rete-backup-import', file: 'ui/senza-rete-backup-import.test.js', cosa: 'senza rete, Backup completo, CSV, import, file rotti, ripristino' },
  { nome: 'offline-completo', file: 'ui/offline-completo.test.js', cosa: 'senza rete o con rete lentissima: apertura subito, Aggiorna, allenamento, backup, sync che riprova', minuti: 4 },
  { nome: 'caratteri', file: 'ui/caratteri.test.js', cosa: 'caratteri in fonts/: impronta, sw.js, salvati e disponibili senza rete' },
  { nome: 'server-in-errore', file: 'ui/server-in-errore.test.js', cosa: 'Netlify in errore: copia salvata' },
  { nome: 'backup-a-termina', file: 'ui/backup-a-termina.test.js', cosa: 'copia a Termina identica ai dati' },
  { nome: 'backup-dati-di-prova', file: 'ui/backup-dati-di-prova.test.js', args: DF, cosa: 'import dei dati di prova: schermate, allenamento, Claude, Telegram, sync' },
  { nome: 'correzione-petto', file: 'ui/correzione-petto.test.js', args: F, cosa: 'muscoli segnati Petto per errore, corretti una volta' },
  { nome: 'salvataggio-uscita', file: 'ui/salvataggio-uscita.test.js', cosa: 'uscendo si riscrive solo il necessario' },
  { nome: 'memoria-piena-dati-rotti', file: 'ui/memoria-piena-dati-rotti.test.js', cosa: 'memoria piena e dati rotti all\'avvio' },
  { nome: 'due-finestre', file: 'ui/due-finestre.test.js', cosa: 'app aperta in due finestre' },
  { nome: 'sicurezza-testi-malevoli', file: 'ui/sicurezza-testi-malevoli.test.js', cosa: 'testi malevoli mostrati come testo, CSV senza formule' },
  { nome: 'sicurezza-dati-server', file: 'ui/sicurezza-dati-server.test.js', cosa: 'dati malevoli dal server' },
  { nome: 'leggerezza', file: 'ui/leggerezza.test.js', cosa: 'conteggi: recupero fermo, timer senza ricalcolo totale, avvio, spunta, niente :has sulla radice' },
  { nome: 'prestazioni-3-anni', file: 'ui/prestazioni-3-anni.test.js', cosa: '3 anni di storico con processore lento', minuti: 6 },
  // sincronizzazione, Telegram, Claude
  { nome: 'sync-due-telefoni', file: 'ui/sync-due-telefoni.test.js', cosa: 'due telefoni: unione, cancellazione, stesso istante, server giù' },
  { nome: 'sync-codice-sbagliato', file: 'ui/sync-codice-sbagliato.test.js', cosa: 'codice sbagliato: niente spazi vuoti' },
  { nome: 'sync-condizionale', file: 'ui/sync-condizionale.test.js', cosa: 'nessun cambiamento: risposta di pochi byte' },
  { nome: 'backup-collegamento', file: 'ui/backup-collegamento.test.js', cosa: 'codice nel backup, ricollega su un telefono nuovo' },
  { nome: 'telegram', file: 'ui/telegram.test.js', cosa: 'backup su Telegram: collega, invii, errori, scollega' },
  { nome: 'telegram-backup-completo', file: 'ui/telegram-backup-completo.test.js', cosa: 'il file di Telegram = Backup completo' },
  { nome: 'claude-collega', file: 'ui/claude-collega.test.js', cosa: 'collegamento con Claude e indirizzo' },
  { nome: 'claude-chiave', file: 'ui/claude-chiave.test.js', cosa: 'nuova chiave, disattiva, senza rete' },
  { nome: 'claude-riquadro-chiaro', file: 'ui/claude-riquadro-chiaro.test.js', cosa: 'riquadro di Claude in tema chiaro' },
  { nome: 'claude-modifica-scheda-app', file: 'ui/claude-modifica-scheda-app.test.js', cosa: 'Claude cambia la scheda: avviso, Rimetti com\'era' },
  { nome: 'claude-corregge-storico', file: 'ui/claude-corregge-storico.test.js', cosa: 'Claude corregge lo storico: permesso, avviso, annulla, conflitto' },
  { nome: 'mcp-chiave', file: 'mcp/chiave.test.mjs', args: c => [c.code], serveCodice: true, cosa: 'connettore: chiave, intestazione, revoca' },
  { nome: 'mcp-modifica-scheda', file: 'mcp/modifica-scheda.test.mjs', args: c => [c.code], serveCodice: true, cosa: 'connettore: modifica_scheda, errori, annulla, concorrenza' },
];
