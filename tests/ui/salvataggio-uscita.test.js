// uscendo dall'app (pagehide) si riscrive solo quello che non è ancora salvato: niente di inutile, niente sovrascritto
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  await A.page.evaluate(seedLogs, { weeks: 2 });
  await A.page.reload(); await A.page.waitForTimeout(400);
  const r = await A.page.evaluate(() => {
    const out = {};
    ['days','logs','settings'].forEach(k=> out[k] = localStorage.getItem('palestra:'+k));
    localStorage.setItem('palestra:days', '{"X":1}'); localStorage.setItem('palestra:logs', '{"X":1}'); localStorage.setItem('palestra:settings', '{"X":1}');
    window.dispatchEvent(new Event('pagehide'));
    const after = {}; ['days','logs','settings'].forEach(k=> after[k] = localStorage.getItem('palestra:'+k));
    return { out, after };
  });
  for (const k of ['days','logs','settings']) {
    const a = r.out[k], b = r.after[k];
    check(b === '{"X":1}', k + ': non riscritto uscendo (era già salvato)');
    if (b === '{"X":1}') continue;
    if (a === b) { console.log(k, 'rewritten, identical'); continue; }
    let i = 0; while (a[i] === b[i]) i++;
    console.log(k, 'DIFF at', i, '\n  before:', a.slice(i-80, i+120), '\n  after :', b.slice(i-80, i+120));
  }
  await browser.close();
})();
