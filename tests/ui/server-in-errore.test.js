// Netlify risponde con un errore (per esempio mentre pubblica): l'app si apre lo stesso dalla copia salvata
const { chromium } = require('playwright');
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {}, sw: true, wait: 1500 });
  await A.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await A.page.reload(); await A.page.waitForTimeout(500);
  await fetch('http://localhost:8888/__ctl?fail=1');
  await A.page.reload(); await A.page.waitForTimeout(800);
  check(/Palestra/.test(await A.page.title()) && await A.page.$$eval('#dayPills .day-pill', x => x.length) >= 3, 'server in errore (500): app aperta dalla copia salvata');
  await fetch('http://localhost:8888/__ctl?fail=0');
  await browser.close();
})();
