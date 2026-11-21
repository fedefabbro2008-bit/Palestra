// Sostituisci: dopo aver scorso in fondo, cercando il primo risultato è in vista sotto la barra di ricerca
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 2 }); await p.reload(); await p.waitForTimeout(300);
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  await p.click('.sess-ex.current .sess-sub-btn'); await p.waitForTimeout(300);
  await p.evaluate(() => { const sh = document.querySelector('#subSheet .sheet'); sh.scrollTop = sh.scrollHeight; });
  await p.fill('#subSearch', 'panca'); await p.waitForTimeout(150);
  const r = await p.evaluate(() => { const bar = document.querySelector('#subSheet .sub-search').getBoundingClientRect(); const first = document.querySelector('#subList .sub-opt:not([hidden])').getBoundingClientRect(); return { barBottom: Math.round(bar.bottom), firstTop: Math.round(first.top), firstBottom: Math.round(first.bottom), vh: innerHeight }; });
  check(r.firstTop >= r.barBottom && r.firstBottom <= r.vh, 'primo risultato in vista dopo aver scorso: ' + JSON.stringify(r));
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
