// Modifica scheda: un esercizio si sposta trascinando la maniglia, col mouse e col dito
const { chromium } = require('playwright');
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const touch of [false, true]) {
    const A = await open({ browser, ls: {} });
    const p = A.page;
    await p.click('#planEditBtn'); await p.waitForTimeout(200);
    const names = () => p.$$eval('#exList .ex-item-row input[data-f="name"]', x => x.map(e => e.value.slice(0, 14)));
    const before = await names();
    await p.evaluate(() => document.querySelectorAll('#exList .ex-drag-handle')[5].scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(200);
    const h = await p.$$('#exList .ex-drag-handle');
    const b1 = await h[5].boundingBox(), b2 = await h[6].boundingBox();
    const x = b1.x + b1.width / 2, y0 = b1.y + b1.height / 2, y1 = b2.y + b2.height / 2 + 40;
    if (!touch) {
      await p.mouse.move(x, y0); await p.mouse.down();
      for (let i = 1; i <= 12; i++) { await p.mouse.move(x, y0 + (y1 - y0) * i / 12); await p.waitForTimeout(25); }
      await p.mouse.up();
    } else {
      const cdp = await p.context().newCDPSession(p);
      const tp = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await tp('touchStart', y0); for (let i = 1; i <= 12; i++) { await tp('touchMove', y0 + (y1 - y0) * i / 12); await p.waitForTimeout(25); } await tp('touchEnd');
    }
    await p.waitForTimeout(300);
    const after = await names();
    const moved = before[5], at = after.indexOf(moved);
    check(at > 5 && after.length === before.length && [...after].sort().join() === [...before].sort().join(), (touch ? 'col dito' : 'col mouse') + ': «' + moved.trim() + '» spostato dalla posizione 6 alla ' + (at + 1));
    await A.ctx.close();
  }
  await browser.close();
})();
