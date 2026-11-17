// Sostituisci: gruppi (consigliati per il muscolo, scheda, comuni), ricerca anche senza maiuscole e con più parole, nome nuovo col muscolo dal nome, salvataggio
const { chromium } = require('playwright');
const { open, full } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#dayPills .day-pill >> nth=0'); await p.waitForTimeout(200);
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  // esercizio di petto (Chest press): apre "Sostituisci"
  const ei = await p.evaluate(() => [...document.querySelectorAll('#sessList .sess-name-input')].findIndex(e => /Chest press/.test(e.value)));
  await p.click(`.sess-sub-btn[data-ei="${ei}"]`); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/100-sub-top.png' });
  const groups = await p.$$eval('#subList .sub-grp', gs => gs.map(g => g.querySelector('.sheet-sec').textContent + ' (' + g.querySelectorAll('.sub-opt').length + ')'));
  check(groups.length === 3 && /Consigliati per Petto/.test(groups[0]), 'gruppi: ' + groups.join(' · '));
  const cons = await p.$$eval('#subList .sub-grp:first-child .so-name', x => x.map(e => e.textContent)); check(cons.length >= 3, 'consigliati per il petto: ' + cons.slice(0, 3).join(', '));
  const shown = () => p.$$eval('#subList .sub-opt:not([hidden]) .so-name', x => x.map(e => e.textContent));
  for (const q of ['panca', 'dorso', 'CURL manubri', 'tricipiti', 'kickback', 'squat', 'pettorali croci']) {
    await p.fill('#subSearch', q); await p.waitForTimeout(80);
    const r = await shown(); const want = { panca: /Panca/, dorso: /Rematore|Trazioni|Lat/, 'CURL manubri': /Curl/, tricipiti: /./, kickback: /Kickback/, squat: null, 'pettorali croci': /Croci/ }[q];
    check(want ? (r.length > 0 && want.test(r[0])) : true, `cerca «${q}»: ${r.length} risultati${r[0] ? ', primo ' + r[0] : ''}`);
  }
  await p.fill('#subSearch', 'xyzzz'); await p.waitForTimeout(80);
  check(await p.isVisible('#subNone') && /Usa «xyzzz»/.test(await p.textContent('#subUseBtn')), 'nessun risultato: lo dice e propone di usare il nome scritto');
  await p.fill('#subSearch', 'Panca Smith'); await p.waitForTimeout(80);
  check(/Panca Smith.*Petto/.test(await p.textContent('#subUseBtn')), 'nome nuovo: muscolo dal nome (Petto)');
  await p.fill('#subSearch', 'panca inclinata bilanciere'); await p.waitForTimeout(80);
  await full(p, OUT + '/101-sub-search.png');
  // Invio con un solo risultato: lo sceglie
  await p.press('#subSearch', 'Enter'); await p.waitForTimeout(400);
  const ex = await p.evaluate(ei => { const x = JSON.parse(localStorage.getItem('palestra:session')).exercises; return x.map(e => e.name + ' [' + e.muscle + (e.secondary ? '+' + e.secondary : '') + ']').filter(n => /Panca|Chest/.test(n)); }, ei);
  check(ex.some(n => /Panca inclinata con bilanciere/.test(n)) && /Sostituito/.test(await p.textContent('#toastMsg')), 'Invio con un risultato solo: sostituito (' + ex.join(', ') + ')');
  // nome scritto a mano: muscolo dal nome
  const ei2 = await p.evaluate(() => [...document.querySelectorAll('#sessList .sess-name-input')].findIndex(e => /Lat machine/.test(e.value)));
  await p.click(`.sess-sub-btn[data-ei="${ei2}"]`); await p.waitForTimeout(300);
  await p.fill('#subSearch', 'Curl Zottman'); await p.waitForTimeout(80);
  check(/Curl Zottman.*Bicipiti/.test(await p.textContent('#subUseBtn')), 'Curl Zottman scritto a mano: Bicipiti dal nome');
  await p.click('#subUseBtn'); await p.waitForTimeout(300);
  const ex2 = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')).exercises.filter(e => /Zottman/.test(e.name)).map(e => e.name + ' [' + e.muscle + '] id ' + e.exId));
  check(ex2.length === 1 && /\[Bicipiti\]/.test(ex2[0]), 'Usa: ' + ex2.join(''));
  // completa e salva: il sostituto conta nel muscolo giusto
  for (let i = 0; i < 40; i++) { const b = await p.$('.sess-set-row.next .check'); if (!b) break; await b.click(); await p.waitForTimeout(20); }
  await p.click('#tbStop').catch(() => {});
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300);
  if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes');
  await p.waitForTimeout(400);
  const saved = await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); const last = Object.values(l).flat().find(s => s.entries.some(e => /Zottman/.test(e.name))); return last.entries.filter(e => /Panca|Zottman/.test(e.name)).map(e => e.name + ' [' + (e.muscle || 'Altro') + '] ' + (e.exId || '')); });
  check(saved.some(x => /Panca inclinata con bilanciere \[Petto\]/.test(x)) && saved.some(x => /Curl Zottman \[Bicipiti\]/.test(x)), 'salvati nello storico col muscolo giusto: ' + saved.join(' · '));
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
