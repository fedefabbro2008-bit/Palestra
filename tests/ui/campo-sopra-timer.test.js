// campo in basso con la tastiera e il timer di recupero aperto: resta visibile sopra il timer
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const w of [320, 390]) {
    const A = await open({ browser, ls: {}, w, h: w === 320 ? 640 : 844 });
    const p = A.page;
    await p.evaluate(seedLogs, { weeks: 3 });
    await p.reload(); await p.waitForTimeout(300);
    await p.click('#startSessionBtn'); await p.waitForTimeout(300);
    for (let i = 0; i < 12 && !(await p.isVisible('#timerBar.show')); i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(80); }   // finché parte un recupero
    const r = await p.evaluate(async () => {
      const main = document.querySelector('main'), wait = ms => new Promise(r => setTimeout(r, ms));
      const el = [...document.querySelectorAll('#sessList .sess-set-row input[data-f="val"]')][8];
      main.scrollTop += el.getBoundingClientRect().top - (innerHeight - 110); await wait(50);   // campo in basso
      el.focus({ preventScroll: true });
      const vh = innerHeight - 300;
      Object.defineProperty(visualViewport, 'height', { get: () => vh, configurable: true });
      window.__kbApply(); await wait(80);
      const er = el.getBoundingClientRect(), tb = document.getElementById('timerBar').getBoundingClientRect();
      return { top: Math.round(er.top), bottom: Math.round(er.bottom), timerTop: Math.round(tb.top), timerShown: document.getElementById('timerBar').classList.contains('show'), view: vh };
    });
    check(r.timerShown, w + 'px: recupero partito');
    check(r.bottom <= r.timerTop && r.top >= 0, w + 'px: campo in basso con la tastiera sopra il timer ' + JSON.stringify(r));
    await A.ctx.close();
  }
  await browser.close();
})();
