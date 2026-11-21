// barra in alto dell'allenamento a 320, 390 e 430 px: titolo visibile e niente errori
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const w of [320, 390, 430]) {
    const A = await open({ browser, ls: {}, w, h: 700 });
    const p = A.page;
    await p.evaluate(seedLogs, { weeks: 3 });
    await p.reload(); await p.waitForTimeout(300);
    await p.click('#startSessionBtn'); await p.waitForTimeout(300);
    for (let i = 0; i < 9; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(20); }
    await p.click('#tbStop').catch(()=>{}); await p.waitForTimeout(200);
    await p.screenshot({ path: OUT + `/90-topbar-${w}.png`, clip: { x: 0, y: 0, width: w, height: 170 } });
    const tw = await p.$eval('#sessTitle', e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), r: Math.round(r.right) }; }), er = A.errors.filter(e => !/Service Worker|404/.test(e));
    check(tw.w > 60 && tw.r <= w && !er.length, w + ' px: titolo largo ' + tw.w + ' px, dentro lo schermo, nessun errore');
    await A.ctx.close();
  }
  await browser.close();
})();
