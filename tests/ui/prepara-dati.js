// Dati di prova al posto di un backup vero (niente dati personali nelle prove): 8 settimane generate con le date di oggi
// (seed.js) più alcuni casi apposta. Scrive un file "Backup completo" in argv[2].
//  - una seduta con 4 esercizi segnati Petto per errore dal vecchio «Aggiungi esercizio» (e Panca piana, Petto giusto)
//  - Riserva · Casa (S): una seduta vecchia senza esercizi in comune e due recenti uguali
//  - impostazioni complete (testo per Claude, salva su File spento)
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const fs = require('fs');
const OUT = process.argv[2];
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 8 });
  const data = await p.evaluate(() => {
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const ago = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
    const days = JSON.parse(localStorage.getItem('palestra:days')), logs = JSON.parse(localStorage.getItem('palestra:logs'));
    const settings = JSON.parse(localStorage.getItem('palestra:settings') || '{}');
    const put = (d, s) => { const k = iso(d); (logs[k] = logs[k] || []).push(s); logs[k].sort((a, b) => a.startedAt - b.startedAt); };
    const at = (d, h) => { const x = new Date(d); x.setHours(h, 5, 0, 0); return x.getTime(); };
    const set = (kg, val) => ({ kg, val, rpe: null, at: null });
    const entry = (name, muscle, exId, n, kg, val) => ({ exId, name, muscle, secondary: null, type: 'reps', sets: n, kg, val, detail: Array.from({ length: n }, () => set(kg, val)) });
    // via le riserve "Casa" generate a caso: le mettiamo noi, prevedibili
    Object.keys(logs).forEach(k => { logs[k] = logs[k].filter(s => s.dayKey !== 'S'); if (!logs[k].length) delete logs[k]; });
    const S = days.S.exercises.filter(e => e.muscle !== 'Altro').slice(0, 3);
    const sess = (id, d, h, entries, extra) => Object.assign({ id, dayKey: 'S', dayName: days.S.name, forDay: 'A', startedAt: at(d, h), endedAt: at(d, h) + 40 * 60000, note: '', entries }, extra || {});
    put(ago(45), sess('prova-s-vecchia', ago(45), 7, [entry('Jumping jack in casa', 'Quadricipiti', 'xvecchio0001', 3, 0, 30)]));
    put(ago(11), sess('prova-s-1', ago(11), 7, S.map(e => entry(e.name, e.muscle, e.id, 3, 0, 10))));
    put(ago(4), sess('prova-s-2', ago(4), 7, S.map(e => entry(e.name, e.muscle, e.id, 3, 0, 12))));
    // esercizi segnati Petto per errore (id che non sono in scheda)
    const rid = i => 'xprova' + String(i).padStart(6, '0');
    put(ago(20), { id: 'prova-petto', dayKey: 'A', dayName: days.A.name, startedAt: at(ago(20), 19), endedAt: at(ago(20), 19) + 60 * 60000, note: 'seduta con muscoli sbagliati', entries: [
      entry('Panca piana', 'Petto', rid(1), 3, 40, 8), entry('Streching - tricipiti', 'Petto', rid(2), 1, 0, 30), entry('Sollevamneto gambe', 'Petto', rid(3), 3, 0, 12),
      entry('Alzate laterali ai manubri', 'Petto', rid(4), 3, 8, 12), entry('Kickback con manubri', 'Petto', rid(5), 3, 6, 12)] });
    Object.assign(settings, { aiContext: 'Obiettivo ipertrofia; spalla sinistra delicata', fileBackupAfter: false });
    return { type: 'palestra-backup', schemaVersion: settings.schemaVersion || 1, exportedAt: new Date().toISOString(), days, logs, settings };
  });
  fs.writeFileSync(OUT, JSON.stringify(data));
  const n = Object.values(data.logs).flat().length;
  console.log('OK   dati di prova: ' + n + ' allenamenti, ' + Object.keys(data.days).length + ' giornate → ' + OUT);
  await A.browser.close();
})();
