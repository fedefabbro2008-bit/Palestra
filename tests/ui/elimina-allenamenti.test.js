// «Altri allenamenti» → «Elimina un allenamento»: acceso, ogni giornata in alto e ogni versione corta mostra una ✕;
// un tocco chiede conferma ed elimina (lo storico resta), «Ripristina» la rimette dov'era (stessa rotazione).
// Se elimini quella scelta, si passa a quella che tocca; l'ultima giornata normale non si elimina.
// «Fatto» (o la zona richiusa) spegne: il tocco torna a scegliere la giornata
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 4 });
  await p.reload(); await p.waitForTimeout(800);
  const days = () => p.evaluate(() => { const d = JSON.parse(localStorage.getItem('palestra:days')); return Object.keys(d).map((k) => k + (d[k].spare ? 's' : '')); });
  const logsN = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  const d0 = await days(), n0 = await logsN();
  await p.tap('#moreBtn'); await p.waitForTimeout(500);
  const b0 = await p.evaluate(() => ({ txt: document.getElementById('delModeBtn').textContent, vis: !!document.getElementById('delModeBtn').offsetParent }));
  check(b0.vis && /Elimina un allenamento/.test(b0.txt), 'nella zona c\'è «Elimina un allenamento»');
  await p.tap('#delModeBtn'); await p.waitForTimeout(200);
  const m = await p.evaluate(() => ({ on: document.getElementById('todayCard').classList.contains('del-mode'), txt: document.getElementById('delModeBtn').textContent,
    x: getComputedStyle(document.querySelector('#sparePills .day-pill[data-k]'), '::after').content, xTop: getComputedStyle(document.querySelector('#dayPills .day-pill[data-k]'), '::after').content }));
  check(m.on && /Fatto/.test(m.txt) && /×/.test(m.x) && /×/.test(m.xTop), `acceso: «${m.txt}», ✕ su versioni corte e giornate`);
  // versione corta: conferma, eliminata, storico intatto; poi Ripristina
  const sk = await p.evaluate(() => document.querySelector('#sparePills .day-pill[data-k]').dataset.k);
  await p.tap(`#sparePills .day-pill[data-k="${sk}"]`); await p.waitForTimeout(300);
  check(await p.isVisible('#confirmOverlay.show') && /Eliminare/.test(await p.textContent('#confirmMsg')), 'tocco: chiede conferma');
  await p.tap('#confirmYes'); await p.waitForTimeout(400);
  const d1 = await days();
  check(!d1.includes(sk + 's') && d1.length === d0.length - 1 && (await logsN()) === n0 && /eliminata/.test(await p.textContent('#toastMsg')), `versione corta eliminata (${d0.join(' ')} → ${d1.join(' ')}), storico intatto`);
  await p.tap('#toastAct'); await p.waitForTimeout(400);
  check(JSON.stringify(await days()) === JSON.stringify(d0), 'Ripristina: rimessa dov\'era (' + (await days()).join(' ') + ')');
  // giornata in alto non scelta: eliminata, la scelta resta
  const cur = await p.evaluate(() => document.querySelector('#dayPills .day-pill.active').dataset.k);
  const other = await p.evaluate(() => [...document.querySelectorAll('#dayPills .day-pill[data-k]:not(.active)')][0].dataset.k);
  await p.tap(`#dayPills .day-pill[data-k="${other}"]`); await p.waitForTimeout(300); await p.tap('#confirmYes'); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ keys: [...document.querySelectorAll('#dayPills .day-pill[data-k]')].map((b) => b.dataset.k), act: document.querySelector('#dayPills .day-pill.active').dataset.k }));
  check(!after.keys.includes(other) && after.act === cur, `giornata «${other}» eliminata, resta scelta «${cur}»`);
  // Annulla nella conferma: niente eliminato
  const before = await days();
  await p.tap(`#dayPills .day-pill[data-k="${cur}"]`); await p.waitForTimeout(300); await p.tap('#confirmNo'); await p.waitForTimeout(300);
  check(JSON.stringify(await days()) === JSON.stringify(before), 'Annulla nella conferma: niente eliminato');
  // quella scelta: si passa a quella che tocca; l'ultima normale non si elimina
  await p.tap(`#dayPills .day-pill[data-k="${cur}"]`); await p.waitForTimeout(300); await p.tap('#confirmYes'); await p.waitForTimeout(400);
  const left = await p.evaluate(() => ({ keys: [...document.querySelectorAll('#dayPills .day-pill[data-k]')].map((b) => b.dataset.k), act: (document.querySelector('#dayPills .day-pill.active') || {}).dataset }));
  check(left.keys.length === 1 && left.act && left.act.k === left.keys[0], `eliminata quella scelta: ora è scelta «${left.act && left.act.k}»`);
  await p.tap(`#dayPills .day-pill[data-k="${left.keys[0]}"]`); await p.waitForTimeout(300);
  check(!(await p.isVisible('#confirmOverlay.show')) && /almeno una giornata normale/.test(await p.textContent('#toastMsg')), 'l\'ultima giornata normale non si elimina: ' + await p.textContent('#toastMsg'));
  // Fatto: il tocco torna a scegliere
  await p.tap('#delModeBtn'); await p.waitForTimeout(200);
  const sk2 = await p.evaluate(() => document.querySelector('#sparePills .day-pill[data-k]').dataset.k);
  await p.tap(`#sparePills .day-pill[data-k="${sk2}"]`); await p.waitForTimeout(400);
  const f = await p.evaluate(() => ({ on: document.getElementById('todayCard').classList.contains('del-mode'), confirm: document.getElementById('confirmOverlay').classList.contains('show'), last: JSON.parse(localStorage.getItem('palestra:settings')).lastDay }));
  check(!f.on && !f.confirm && f.last === sk2, `«Fatto»: spento, il tocco sceglie di nuovo (scelta «${f.last}»)`);
  // zona richiusa: spento
  await p.tap('#moreBtn'); await p.waitForTimeout(400); await p.tap('#delModeBtn'); await p.waitForTimeout(150); await p.tap('#moreBtn'); await p.waitForTimeout(400);
  check(!(await p.evaluate(() => document.getElementById('todayCard').classList.contains('del-mode'))), 'zona richiusa: modalità elimina spenta');
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
