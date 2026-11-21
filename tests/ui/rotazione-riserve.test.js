// rotazione delle giornate e riserve: la riserva vale come la giornata che tocca, dopo tocca la successiva, anche dopo il riavvio
const { open, tab, full } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const activePill = page => page.evaluate(() => { const a = document.querySelector('#dayPills .day-pill.active .dp-key'); return a ? a.textContent : null; });
(async () => {
  let { browser, page, errors } = await open({ ls: {} });
  await page.evaluate(seedLogs, { weeks: 4 });
  await page.reload(); await page.waitForTimeout(500);
  const due = await activePill(page), h0 = await page.textContent('#nextHint');
  console.log('due before:', due, '| hint:', h0);
  check(!!due && /Tocca a questa/.test(h0), 'all\'apertura è scelta la giornata che tocca: ' + due);
  // allenamento corto
  await page.click('#moreBtn'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/10-spare-sheet.png' });
  await page.click('#sparePills .day-pill >> nth=0'); await page.waitForTimeout(300);
  const sh = await page.textContent('#nextHint'); console.log('spare hint:', sh);
  const m = /vale come (.+?) · dopo tocca (.+)$/.exec(sh.trim());
  check(!!m && m[1].trim() === due, 'la riserva vale come la giornata che tocca (' + (m && m[1]) + ')');
  await page.click('#startSessionBtn'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/11-session-start.png' });
  // spunta tutte le serie, una alla volta
  let n = 0;
  for (;;) {
    const b = await page.$('.sess-set-row.next .check'); if (!b) break;
    await b.click(); n++; await page.waitForTimeout(60);
    if (n > 80) break;
  }
  console.log('checked sets:', n);
  check(n >= 8, 'spuntate tutte le serie della riserva: ' + n);
  await page.screenshot({ path: OUT + '/12-session-done.png' });
  await page.click('#sessFinishBtn'); await page.waitForTimeout(400);
  // eventuali avvisi prima di salvare
  if (await page.isVisible('#confirmOverlay.show')) { console.log('confirm:', (await page.textContent('#confirmMsg')).slice(0, 200)); await page.click('#confirmYes'); await page.waitForTimeout(400); }
  await page.waitForTimeout(500);
  const a1 = await activePill(page), h1 = await page.textContent('#nextHint'); console.log('after finish active:', a1, '| hint:', h1);
  check(!!m && a1 === m[2].trim() && /Riserva al posto di/.test(h1), 'dopo Termina tocca la giornata successiva (' + a1 + ') e l\'ultima è la riserva');
  await page.screenshot({ path: OUT + '/13-after-finish.png' });
  await page.reload(); await page.waitForTimeout(500);
  const a2 = await activePill(page); console.log('after reload active:', a2);
  check(a2 === a1, 'dopo il riavvio è ancora ' + a2);
  const er = errors.filter(e => !/Service Worker|installing|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
