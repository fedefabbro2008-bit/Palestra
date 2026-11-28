// dati lasciati da versioni precedenti: l'app si apre senza errori e resta usabile.
// - giornata senza esercizi (il connettore prima della 1.4.0 poteva crearla): si vede, la rotazione la salta e, se la
//   scegli, «Inizia» apre l'allenamento che dice di aggiungere un esercizio (non «Tutte le serie fatte»);
// - allenamento libero vuoto salvato (prima partiva prima di scegliere il primo esercizio): all'apertura si scarta;
// - storico nel formato lungo (non compatto): si legge uguale e si riscrive compatto
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 4 });
  const n0 = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  const long0 = await p.evaluate(() => localStorage.getItem('palestra:logs').length);
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('palestra:days')); d.D = { name: 'Sabato · Vuota dal connettore', exercises: [] }; localStorage.setItem('palestra:days', JSON.stringify(d));
    localStorage.setItem('palestra:session', JSON.stringify({ id: 'vecchio', dayKey: 'free', dayName: 'Allenamento libero', startedAt: Date.now() - 60000, note: '', exercises: [] }));
  });
  await p.reload(); await p.waitForTimeout(4500);   // il controllo dello storico è rimandato di poco dopo l'apertura
  const st = await p.evaluate(() => ({ session: localStorage.getItem('palestra:session'), view: document.getElementById('sessionView').style.display, pills: [...document.querySelectorAll('#dayPills .day-pill[data-k]')].map((x) => x.dataset.k), active: (document.querySelector('#dayPills .day-pill.active') || {}).dataset }));
  check(!st.session && st.view !== 'block', 'allenamento libero vuoto di una versione vecchia: scartato all\'apertura');
  check(st.pills.includes('D') && st.active && st.active.k !== 'D', `giornata vuota: si vede (${st.pills.join(' ')}) ma non è quella che tocca (${st.active && st.active.k})`);
  const logs = await p.evaluate(() => ({ n: Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length, len: localStorage.getItem('palestra:logs').length }));
  check(logs.n === n0 && logs.len < long0, `storico nel formato lungo: stessi ${logs.n} allenamenti, riscritto compatto (${long0} → ${logs.len} caratteri)`);
  // «Inizia» sulla giornata vuota: l'allenamento dice di aggiungere un esercizio; aggiunto, si fa e si salva
  await p.click('#dayPills .day-pill[data-k="D"]'); await p.waitForTimeout(300);
  await p.click('#startSessionBtn'); await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ s: JSON.parse(localStorage.getItem('palestra:session') || 'null'), title: document.getElementById('sessTitle').textContent, eta: document.getElementById('sessEta').textContent }));
  check(r.s && r.s.dayKey === 'D' && !r.s.exercises.length && /Aggiungi un esercizio/.test(r.title) && /Nessun esercizio ancora/.test(r.eta) && !/Tutte le serie fatte/.test(r.eta), `Inizia sulla giornata vuota: «${r.title.trim()}», «${r.eta.trim()}»`);
  await p.click('#sessAddExBtn'); await p.waitForTimeout(300); await p.click('#subList .sub-opt >> nth=0'); await p.waitForTimeout(300);
  await p.click('.sess-set-row.next .check'); await p.waitForTimeout(100);
  await p.click('#tbStop').catch(() => {});
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300); if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(300); }
  const n1 = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().filter((x) => x.dayKey === 'D').length);
  check(n1 === 1, 'con un esercizio aggiunto l\'allenamento della giornata vuota si salva');
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
