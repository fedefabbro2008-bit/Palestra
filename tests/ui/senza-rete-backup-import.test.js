// uso senza rete (service worker), Backup completo e CSV, import di un backup, file rotti, ripristino della copia automatica
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = require('path').resolve(process.argv[2]);
const clean = e => e.filter(x => !/404|Service Worker registration blocked/.test(x));
const count = p => p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs') || '{}'); return Object.values(l).reduce((a, x) => a + x.length, 0); });
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  // --- offline ---
  const A = await open({ browser, ls: {}, sw: true, wait: 1500 });
  const ctl = await A.page.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; });
  check(ctl && /senza rete/.test(await A.page.textContent('#offlineStatus')), 'service worker attivo: «' + await A.page.textContent('#offlineStatus') + '»');
  await A.page.reload(); await A.page.waitForTimeout(800);
  check(await A.page.evaluate(() => !!navigator.serviceWorker.controller), 'dopo il riavvio la pagina passa dal service worker');
  await A.ctx.setOffline(true);
  await A.page.reload(); await A.page.waitForTimeout(800);
  const pills = await A.page.$$eval('#dayPills .day-pill', x => x.length);
  const fonts = await A.page.evaluate(async () => { await document.fonts.ready; return ['Inter', 'Space Grotesk', 'JetBrains Mono'].filter(f => [...document.fonts].some(x => x.family.replace(/"/g, '') === f && x.status === 'loaded')); });
  check(/Palestra/.test(await A.page.title()) && pills >= 3, 'senza rete l\'app si apre lo stesso (' + pills + ' giornate)');
  check(fonts.length === 3, 'senza rete i caratteri ci sono: ' + fonts.join(', '));
  await A.ctx.setOffline(false);
  const eo = clean(A.errors).filter(x => !/ERR_INTERNET_DISCONNECTED|net::/.test(x)); check(!eo.length, 'senza rete: nessun errore ' + eo.join('|'));
  // --- backup e import ---
  const B = await open({ browser, ls: {} });
  await B.page.evaluate(seedLogs, { weeks: 3 });
  await B.page.reload(); await B.page.waitForTimeout(400);
  await B.page.click('#settingsBtn');
  const [dl] = await Promise.all([B.page.waitForEvent('download'), B.page.click('#exportAllBtn')]);
  const file = OUT + '/backup.json'; await dl.saveAs(file);
  const j = require(file); check(/\.json$/.test(dl.suggestedFilename()) && j.type === 'palestra-backup' && Object.keys(j.logs).length > 0 && Object.keys(j.days).length >= 3, 'Backup completo: ' + dl.suggestedFilename() + ', ' + Object.values(j.logs).flat().length + ' allenamenti');
  await B.page.waitForTimeout(300);
  check(/salvato/i.test(await B.page.textContent('#toastMsg')), 'avviso: ' + await B.page.textContent('#toastMsg'));
  const [dl2] = await Promise.all([B.page.waitForEvent('download'), (async () => { await B.page.click('#backupMoreBtn'); await B.page.click('#exportCsvBtn'); })()]);
  const csvF = OUT + '/export.csv'; await dl2.saveAs(csvF);
  const csv = require('fs').readFileSync(csvF, 'utf8').split('\r\n'); check(csv.length > 10 && /^\uFEFF?data;ora;giornata;esercizio;/.test(csv[0]), 'CSV: ' + csv.length + ' righe, intestazione «' + csv[0].slice(0, 60) + '»');
  const C = await open({ browser, ls: {} });
  await C.page.click('#settingsBtn');
  await C.page.setInputFiles('#importFile', file); await C.page.waitForTimeout(600);
  check(/Importato/.test(await C.page.textContent('#toastMsg')) && await count(C.page) === Object.values(j.logs).flat().length, 'import su un telefono vuoto: ' + await count(C.page) + ' allenamenti');
  // import di un file rotto
  require('fs').writeFileSync(OUT + '/bad.json', '{"type":"palestra-backup","logs":[1,2],"days":"x"}');
  await C.page.setInputFiles('#importFile', OUT + '/bad.json'); await C.page.waitForTimeout(400);
  check(!/Importato/.test(await C.page.textContent('#toastMsg')) && await count(C.page) === Object.values(j.logs).flat().length, 'file rotto: rifiutato, dati intatti (' + await C.page.textContent('#toastMsg') + ')');
  require('fs').writeFileSync(OUT + '/notjson.json', 'ciao');
  await C.page.setInputFiles('#importFile', OUT + '/notjson.json'); await C.page.waitForTimeout(400);
  check(!/Importato/.test(await C.page.textContent('#toastMsg')), 'file non JSON: rifiutato (' + await C.page.textContent('#toastMsg') + ')');
  // ripristino del backup automatico (IndexedDB)
  await B.page.click('#restoreBackupBtn'); await B.page.waitForTimeout(400);
  check(await B.page.isVisible('#confirmOverlay.show'), 'Ripristina copia automatica: chiede conferma');
  await B.page.click('#confirmYes'); await B.page.waitForTimeout(500);
  check(/Ripristinat/.test(await B.page.textContent('#toastMsg')), 'ripristino: ' + await B.page.textContent('#toastMsg'));
  const eb = clean(B.errors.concat(C.errors)); check(!eb.length, 'nessun errore ' + eb.join('|'));
  await browser.close();
})();
