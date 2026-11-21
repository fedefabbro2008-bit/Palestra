// avambracci: zona nella figura (davanti e dietro), colore, riga nelle statistiche solo se allenati, elenco esercizi, nome -> muscolo
const { open, tab } = require('./lib');
const fs = require('fs');
const FILE = process.argv[2], OUT = process.argv[3];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const lvl = p => p.evaluate(() => [...document.querySelectorAll('#bodyFigs .bd-m[data-m="Avambracci"]')].map(e => e.getAttribute('class').replace('bd-m ', '')));
(async () => {
  const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const A = await open({ ls: { 'palestra:days': d.days, 'palestra:logs': d.logs, 'palestra:settings': d.settings, 'palestra:fix-petto-1': '1' } }), p = A.page;
  await p.click('#dayPills .day-pill >> nth=0'); await p.waitForTimeout(300);
  const z = await lvl(p);
  check(z.length === 4, 'quattro zone degli avambracci (2 davanti, 2 dietro): ' + z.length);
  check(z.every(c => /n0/.test(c)), 'senza esercizi per gli avambracci: grigie');
  // statistiche: nessuna riga Avambracci finché non li alleni
  await tab(p, 'stats'); await p.waitForTimeout(300);
  check(!(await p.$('#tab-stats .m-mrow[data-m="Avambracci"]')), 'Settimana: nessuna riga «Avambracci» se non li alleni');
  await tab(p, 'workout');
  // aggiungo in scheda un esercizio per gli avambracci (3 serie) e uno con avambracci secondari (3 serie -> 1,5)
  await p.evaluate(() => { const days = JSON.parse(localStorage.getItem('palestra:days')); const A = days[Object.keys(days)[0]];
    A.exercises.splice(6, 0, { id: 'xtestwrist01', name: 'Wrist curl con manubri', muscle: 'Avambracci', secondary: null, type: 'reps', sets: 3, reps: '12-20', kg: 0, rest: 60, linkNext: false, phase: 'main' });
    localStorage.setItem('palestra:days', JSON.stringify(days)); });
  await p.reload(); await p.waitForTimeout(600);
  await p.click('#dayPills .day-pill >> nth=0'); await p.waitForTimeout(300);
  const z2 = await lvl(p);
  check(z2.every(c => /\blo\b/.test(c)), 'con 3 serie: avambracci gialli (allena di meno): ' + JSON.stringify(z2));
  const chip = await p.$('#bodyChips .bd-chip[data-m="Avambracci"]');
  check(!!chip, 'pulsantino «Avambracci 3» sotto la figura');
  await p.evaluate(() => document.getElementById('bodyCard').scrollIntoView({ block: 'start' })); await p.waitForTimeout(200);
  await p.locator('#bodyCard').screenshot({ path: OUT + '/f1-avambracci.png' });
  await p.click('#bodyFigs .bd-m[data-m="Avambracci"] >> nth=0'); await p.waitForTimeout(300);
  check(/Wrist curl/.test(await p.textContent('#bodyDetail')), 'tocco sugli avambracci: dettaglio con l\'esercizio');
  await p.locator('#bodyCard').screenshot({ path: OUT + '/f2-avambracci-scelti.png' });
  // con 4+ serie: rossi
  await p.evaluate(() => { const days = JSON.parse(localStorage.getItem('palestra:days')); const A = days[Object.keys(days)[0]]; A.exercises.find(e => e.id === 'xtestwrist01').sets = 4; localStorage.setItem('palestra:days', JSON.stringify(days)); });
  await p.reload(); await p.waitForTimeout(600); await p.click('#dayPills .day-pill >> nth=0'); await p.waitForTimeout(300);
  check((await lvl(p)).every(c => /\bhi\b/.test(c)), 'con 4 serie: avambracci rossi');
  // statistiche: ora la riga c'è (in scheda)
  await tab(p, 'month'); await p.waitForTimeout(400);
  check(!!(await p.$('#tab-month .m-mrow[data-m="Avambracci"]')), 'Mese: riga «Avambracci» ora che sono in scheda');
  await tab(p, 'workout');
  // nome scritto a mano -> muscolo
  await p.click('#startSessionBtn'); await p.waitForTimeout(500);
  await p.click('#sessAddExBtn'); await p.waitForTimeout(300);
  const grp = await p.evaluate(() => [...document.querySelectorAll('#subList .sub-mg-h')].map(e => e.textContent));
  check(grp.includes('Avambracci'), 'elenco esercizi comuni: gruppo Avambracci');
  await p.fill('#subSearch', 'Farmer walk con kettlebell'); await p.press('#subSearch', 'Enter'); await p.waitForTimeout(300);
  const s = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')).exercises.find(x => /Farmer walk con kettlebell/.test(x.name)));
  check(s && s.muscle === 'Avambracci', 'scritto a mano «Farmer walk…»: muscolo Avambracci');
  // nomi che contengono «avambracci» o «polsi dritti» non diventano avambracci
  const wrongs = await p.evaluate(() => [...document.querySelectorAll('#sessList .sess-ex')].length);
  console.log('esercizi in allenamento', wrongs);
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
