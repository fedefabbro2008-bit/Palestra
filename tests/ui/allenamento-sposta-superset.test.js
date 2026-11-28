// in allenamento: sposta, superset, aggiungi (anche al superset); allenamento libero; fine = ultima spunta
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const names = p => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')).exercises.map(x => x.name.slice(0, 18) + (x.linkNext ? '+' : '')));
const sess = p => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')));
const meta = async (p, i) => { await p.click(`#sessList .sess-meta-btn[data-ei="${i}"]`); await p.waitForTimeout(150); };
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 });
  await p.reload(); await p.waitForTimeout(400);
  const dayBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:settings')).lastDay);
  await p.click('#startSessionBtn'); await p.waitForTimeout(500);
  const n0 = await names(p); console.log('inizio:', n0.join(' | '));
  const iMain = n0.findIndex(x => /Chest press|Hyperext|Trazioni/.test(x));
  // 1. esercizio a sé giù di uno
  await meta(p, iMain); await p.click(`#sessList .sess-mv[data-ei="${iMain}"][data-d="1"]`); await p.waitForTimeout(250);
  const n1 = await names(p); check(n1[iMain + 1] === n0[iMain] && n1[iMain] === n0[iMain + 1], 'Giù: ' + n0[iMain] + ' scende di uno');
  // 2. scavalca il superset intero
  const iPd0 = n1.findIndex(x => /\+$/.test(x));
  const iBefore = iPd0 - 1;
  await meta(p, iBefore); await p.click(`#sessList .sess-mv[data-ei="${iBefore}"][data-d="1"]`); await p.waitForTimeout(250);
  const n2 = await names(p);
  check(n2[iBefore + 2] === n1[iBefore] && n2[iBefore] === n1[iPd0] && n2[iBefore + 1] === n1[iPd0 + 1], 'scavalca il superset intero: ' + n2.slice(iBefore, iBefore + 3).join(' | '));
  // 3. dentro il superset: scambio
  const iPd = n2.findIndex(x => /\+$/.test(x));
  const rest0 = (await sess(p)).exercises[iPd + 1].rest;
  await meta(p, iPd); await p.click(`#sessList .sess-mv[data-ei="${iPd}"][data-d="1"]`); await p.waitForTimeout(250);
  const n3 = await names(p); check(n3[iPd] === n2[iPd + 1] + '+' && n3[iPd + 1] + '+' === n2[iPd], 'dentro il superset: scambiati, ancora uniti: ' + n3.slice(iPd, iPd + 2).join(' | '));
  const s3 = await sess(p); check(s3.exercises[iPd + 1].rest === rest0, 'recupero del giro resta all\'ultimo: ' + s3.exercises[iPd + 1].rest);
  // 4. esercizio in superset
  await meta(p, iPd); await p.click(`#sessList .sess-add-grp[data-ei="${iPd}"]`); await p.waitForTimeout(300);
  check(/Aggiungi al superset/.test(await p.textContent('#subSheetTitle')), 'pannello: ' + await p.textContent('#subSheetTitle') + ' · ' + await p.textContent('#subSheetSub'));
  await p.screenshot({ path: OUT + '/a1-pannello.png' });
  await p.fill('#subSearch', 'kickback'); await p.waitForTimeout(150);
  await p.click('#subList .sub-opt:not([hidden]) >> nth=0'); await p.waitForTimeout(300);
  const n4 = await names(p); check(/\+$/.test(n4[iPd]) && /\+$/.test(n4[iPd + 1]) && /Kickback/i.test((await sess(p)).exercises[iPd + 2].name), 'aggiunto in fondo al superset: ' + n4.slice(iPd, iPd + 3).join(' | '));
  const s4 = await sess(p); check(s4.exercises[iPd + 2].rest === rest0, 'il nuovo ultimo prende il recupero del giro');
  // 5. Superset col successivo / staccalo
  const iLat = 0 + n4.findIndex((x, i) => i > 0 && !/\+$/.test(x) && !/\+$/.test(n4[i - 1]) && i < n4.length - 1);
  await meta(p, iLat); await p.click(`#sessList .sess-link[data-ei="${iLat}"]`); await p.waitForTimeout(250);
  check((await names(p))[iLat].endsWith('+'), 'Superset col successivo: unito (' + n4[iLat] + ')');
  await p.click(`#sessList .sess-link[data-ei="${iLat}"]`); await p.waitForTimeout(250);
  const s5 = await sess(p); check(!s5.exercises[iLat].linkNext && s5.exercises[iLat].rest > 0, 'Staccalo: di nuovo a sé, col recupero');
  await p.evaluate(() => document.querySelector('#sessList .sess-ex.show-meta').scrollIntoView({ block: 'center' })); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/a2-menu.png' });
  // 6. + Aggiungi esercizio
  await p.click('#sessAddExBtn'); await p.waitForTimeout(300);
  check(/Aggiungi esercizio/.test(await p.textContent('#subSheetTitle')) && /Fatti di recente/.test(await p.textContent('#subList')), 'Aggiungi esercizio: elenco con "Fatti di recente"');
  await p.fill('#subSearch', 'Curl Zottman'); await p.press('#subSearch', 'Enter'); await p.waitForTimeout(300);
  const s6 = await sess(p), z = s6.exercises.find(x => x.name === 'Curl Zottman');
  check(!!z && z.muscle === 'Bicipiti' && z.sets.length === 3, 'scritto a mano: Curl Zottman, ' + (z && z.muscle) + ', ' + (z && z.sets.length) + ' serie');
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300); await p.click('#confirmYes'); await p.waitForTimeout(400);
  // 7. allenamento libero
  if (!(await p.isVisible('#freeOpenBtn'))) { await p.click('#moreBtn'); await p.waitForTimeout(300); } await p.click('#freeOpenBtn'); await p.waitForTimeout(400);
  check(/Allenamento libero/.test(await p.textContent('#subSheetTitle')), 'Allenamento libero: si apre subito l\'elenco, col suo titolo');
  await p.click('#subSheetClose'); await p.waitForTimeout(300);
  check(!(await p.evaluate(() => localStorage.getItem('palestra:session'))) && await p.isVisible('#planView'), 'chiuso senza scegliere: allenamento libero vuoto annullato');
  if (!(await p.isVisible('#freeOpenBtn'))) { await p.click('#moreBtn'); await p.waitForTimeout(300); } await p.click('#freeOpenBtn'); await p.waitForTimeout(400);
  await p.fill('#subSearch', 'trazioni presa neutra'); await p.waitForTimeout(150);
  await p.click('#subList .sub-opt:not([hidden]) >> nth=0'); await p.waitForTimeout(300);
  await p.click('#sessAddExBtn'); await p.waitForTimeout(300);
  await p.fill('#subSearch', 'piegamenti su pugni'); await p.waitForTimeout(150);
  await p.click('#subList .sub-opt:not([hidden]) >> nth=0'); await p.waitForTimeout(300);
  console.log('libero:', (await names(p)).join(' | '), '| titolo', await p.textContent('#sessTitle'));
  await p.screenshot({ path: OUT + '/a3-libero.png' });
  for (let i = 0; i < 20; i++) { const b = await p.$$('#sessList .sess-set-row:not(.done) .check'); if (!b.length) break; await b[0].click(); await p.waitForTimeout(150); }
  const lastAt = await p.evaluate(() => Math.max(...JSON.parse(localStorage.getItem('palestra:session')).exercises.flatMap(x => x.sets.map(s => s.at || 0))));
  await p.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 20 * 60000; });
  await p.click('#sessFinishBtn'); await p.waitForTimeout(500);
  if (await p.isVisible('#confirmOverlay.show')) { console.log('conferma:', (await p.textContent('#confirmMsg')).slice(0, 160)); await p.click('#confirmYes'); await p.waitForTimeout(500); }
  const rec = await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); return Object.values(l).flat().find(s => s.dayKey === 'free'); });
  check(rec.dayKey === 'free' && rec.dayName === 'Allenamento libero' && rec.entries.length === 2, 'salvato: allenamento libero con ' + rec.entries.length + ' esercizi');
  check(Math.abs(rec.endedAt - lastAt) < 1000, 'fine = ultima spunta (non 20 minuti dopo): durata ' + Math.round((rec.endedAt - rec.startedAt) / 1000) + ' s');
  const dayAfter = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:settings')).lastDay);
  check(dayAfter === dayBefore, 'rotazione invariata: tocca ancora ' + dayAfter);
  check(/Allenamento completato/.test(await p.textContent('#doneCard')), 'riepilogo: ' + (await p.textContent('#doneCard')).replace(/\s+/g, ' ').trim().slice(0, 120));
  await p.screenshot({ path: OUT + '/a4-fine.png' });
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
