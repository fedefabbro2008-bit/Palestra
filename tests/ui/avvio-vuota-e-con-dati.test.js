// prima apertura (app vuota) e con 10 settimane di storico: tutte le sezioni senza errori, Impostazioni che scorrono
const { open, tab, full } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  // 1. prima apertura
  let { browser, page, errors } = await open({ ls: {} });
  await full(page, OUT + '/01-empty-workout.png');
  for (const t of ['stats', 'month', 'plan']) { await tab(page, t); await full(page, OUT + `/01-empty-${t}.png`); }
  const e0 = errors.filter(x => !/Service Worker|404/.test(x)); check(!e0.length, 'app vuota: tutte le sezioni senza errori ' + e0.join('|'));
  // 2. con storico
  await page.evaluate(seedLogs, { weeks: 10 });
  await page.reload(); await page.waitForTimeout(600);
  errors.length = 0;
  await full(page, OUT + '/02-data-workout.png');
  for (const t of ['stats', 'month', 'plan']) { await tab(page, t); await page.waitForTimeout(300); await full(page, OUT + `/02-data-${t}.png`); }
  await tab(page, 'workout');
  await page.click('#settingsBtn'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/03-settings.png' });
  const sh = await page.evaluate(()=>{ const s=document.querySelector('#settingsSheet .sheet'); return [s.scrollHeight, s.clientHeight]; });
  check(sh[0] > sh[1], 'Impostazioni: il pannello scorre (contenuto ' + sh[0] + ' px su ' + sh[1] + ')');
  const e1 = errors.filter(x => !/Service Worker|404/.test(x)); check(!e1.length, 'con storico: tutte le sezioni senza errori ' + e1.join('|'));
  await browser.close();
})();
