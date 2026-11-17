// tre anni di storico (420 allenamenti) con il processore rallentato 4 volte: avvio e azioni restano entro tempi larghi
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  const n = await p.evaluate(seedLogs, { weeks: 156, rpe: true });
  const size = await p.evaluate(() => localStorage.getItem('palestra:logs').length);
  check(n > 400, 'storico di prova: ' + n + ' allenamenti, ' + Math.round(size / 1024) + ' KB');
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // tempo di avvio: dal caricamento alla fine dello script
  await p.addInitScript(() => { window.__t0 = performance.now(); });
  const t0 = Date.now(); await p.reload({ waitUntil: 'load' }); const load = Date.now() - t0;
  const perf = await p.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd) }; });
  check(load < 3000, 'avvio: ' + load + ' ms (limite 3000)');
  const sizeAfter = await p.evaluate(() => localStorage.getItem('palestra:logs').length);
  check(sizeAfter <= size, 'storico salvato in forma compatta: ' + Math.round(sizeAfter / 1024) + ' KB');
  const time = async (label, fn, max) => { const t = Date.now(); await fn(); const ms = Date.now() - t; check(ms < (max || 2000), label + ': ' + ms + ' ms (limite ' + (max || 2000) + ')'); };
  await p.waitForTimeout(4000);   // statistiche preparate in background
  await time('tab stats', () => p.click('nav.bottom button[data-tab="stats"]'));
  await time('tab month', () => p.click('nav.bottom button[data-tab="month"]'));
  await time('tab plan', () => p.click('nav.bottom button[data-tab="plan"]'));
  await time('tab workout', () => p.click('nav.bottom button[data-tab="workout"]'));
  await time('start session', () => p.click('#startSessionBtn'));
  await time('check set', () => p.click('.sess-set-row.next .check'));
  await time('check set 2', () => p.click('.sess-set-row.next .check'));
  await p.click('#tbStop');
  await time('finish', async () => { await p.click('#sessFinishBtn'); await p.waitForSelector('#sessionView', { state: 'hidden' }); });
  // long tasks durante l'uso
  const hide = await p.evaluate(() => { const t = performance.now(); window.dispatchEvent(new Event('pagehide')); return Math.round(performance.now() - t); });
  check(hide < 600, 'salvataggio uscendo dall\'app: ' + hide + ' ms');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
