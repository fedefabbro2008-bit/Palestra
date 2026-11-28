// casi limite: allenamento lasciato aperto (salvato da solo), non si può togliere l'ultima giornata normale, riprendi un allenamento terminato e annulla
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const activePill = page => page.evaluate(() => { const a = document.querySelector('#dayPills .day-pill.active .dp-key'); return a ? a.textContent : null; });
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  await A.page.evaluate(seedLogs, { weeks: 2 });
  // sessione di riserva lasciata aperta 7 ore fa, valida come Mercoledì (B)
  await A.page.evaluate(() => {
    const days = JSON.parse(localStorage.getItem('palestra:days'));
    const t = Date.now() - 7 * 3600e3;
    const ex = days.R.exercises.filter(e => e.sets > 0).slice(0, 2).map(e => ({ exId: e.id, name: e.name, muscle: e.muscle, secondary: e.secondary, type: e.type, phase: 'main', rest: e.rest, linkNext: false, plan: { sets: e.sets, reps: e.reps }, prevRef: [], prevIso: null,
      sets: [{ kg: 20, val: 10, rpe: null, done: true, at: t + 60000 }, { kg: 20, val: 10, rpe: null, done: false, at: null }] }));
    localStorage.setItem('palestra:session', JSON.stringify({ id: 'stale1', dayKey: 'R', dayName: days.R.name, forDay: 'B', startedAt: t, note: '', exercises: ex }));
  });
  await A.page.reload(); await A.page.waitForTimeout(500);
  check(await activePill(A.page) === 'Venerdì' && /lasciato aperto/.test(await A.page.textContent('#toastMsg')), 'riserva lasciata aperta 7 ore fa: salvata come Mercoledì, ora tocca Venerdì');
  // eliminazione dell'ultima giornata normale
  await A.page.evaluate(() => { const d = JSON.parse(localStorage.getItem('palestra:days')); delete d.B; delete d.C; localStorage.setItem('palestra:days', JSON.stringify(d)); localStorage.removeItem('palestra:session'); });
  await A.page.reload(); await A.page.waitForTimeout(400);
  await A.page.click('#planEditBtn'); await A.page.click('#deleteDayBtn'); await A.page.waitForTimeout(300);
  check(/almeno una giornata normale/.test(await A.page.textContent('#toastMsg')) && !(await A.page.isVisible('#confirmOverlay.show')), 'ultima giornata normale: non si toglie');
  // riprendi un allenamento terminato e annulla
  await A.page.click('#planEditBtn');
  await A.page.click('#startSessionBtn'); await A.page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) { const b = await A.page.$('.sess-set-row.next .check'); if (b) await b.click(); await A.page.waitForTimeout(50); }
  await A.page.click('#sessFinishBtn'); await A.page.waitForTimeout(300);
  if (await A.page.isVisible('#confirmOverlay.show')) await A.page.click('#confirmYes');
  await A.page.waitForTimeout(400);
  const n1 = await A.page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  await A.page.click('#doneResume'); await A.page.waitForTimeout(400);
  const inSess = await A.page.isVisible('#sessionView');
  const n2 = await A.page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  await A.page.click('#sessCancelBtn'); await A.page.waitForTimeout(200); await A.page.click('#confirmYes'); await A.page.waitForTimeout(400);
  const n3 = await A.page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  check(n2 === n1 - 1 && inSess, 'Riprendi: l\'allenamento torna aperto e lascia lo storico');
  check(n3 === n1 && /rimesso/.test(await A.page.textContent('#toastMsg')), 'annullato: rimesso nello storico com\'era');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
