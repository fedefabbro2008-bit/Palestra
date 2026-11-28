// tastiera e tocco: in allenamento il campo non finisce sotto la barra in alto (320 e 390 px, stima aperta e chiusa)
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[320, 640], [390, 844]]) {
    for (const eta of [true, false]) {
      const A = await open({ browser, ls: {}, w, h });
      const p = A.page;
      await p.evaluate(seedLogs, { weeks: 3 });
      await p.reload(); await p.waitForTimeout(300);
      await p.click('#startSessionBtn'); await p.waitForTimeout(300);
      if (eta) { await p.click('#sessEta'); await p.waitForTimeout(200); }
      const r = await p.evaluate(async () => {
        const main = document.querySelector('main'), bar = document.querySelector('.session-topbar');
        const el = [...document.querySelectorAll('#sessList .sess-set-row input[data-f="kg"]')][6];
        const cov = () => getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom : main.getBoundingClientRect().top;
        const wait = ms => new Promise(r => setTimeout(r, ms));
        // 1) tastiera (simulata): il campo appena sotto il bordo di main, quindi sotto la barra
        el.scrollIntoView({ block: 'start' }); main.scrollTop -= 5; await wait(50);
        el.focus({ preventScroll: true });
        Object.defineProperty(visualViewport, 'height', { get: () => innerHeight - 300, configurable: true });
        window.__kbApply(); await wait(50);
        const er = el.getBoundingClientRect();
        const kb = { top: Math.round(er.top), bottom: Math.round(er.bottom), cover: Math.round(cov()), view: innerHeight - 300 };
        delete visualViewport.height; el.blur(); window.__kbApply(); await wait(50);
        // 2) focus nativo
        el.scrollIntoView({ block: 'start' }); main.scrollTop -= 5; await wait(50);
        el.focus(); await wait(80);
        const nat = { top: Math.round(el.getBoundingClientRect().top), cover: Math.round(cov()) };
        return { barH: Math.round(bar.offsetHeight), kb, nat };
      });
      const ok1 = r.kb.top >= r.kb.cover && r.kb.bottom <= r.kb.view, ok2 = r.nat.top >= r.nat.cover;
      check(ok1, `${w}px stima ${eta ? 'aperta' : 'chiusa'}: con la tastiera il campo resta sotto la barra ${JSON.stringify(r.kb)}`);
      check(ok2, `${w}px stima ${eta ? 'aperta' : 'chiusa'}: toccato, il campo resta sotto la barra ${JSON.stringify(r.nat)}`);
      const errs = A.errors.filter(e => !/Service Worker|404/.test(e));
      check(!errs.length, 'nessun errore ' + JSON.stringify(errs));
      await A.ctx.close();
    }
  }
  // pagina normale: campo nome giornata in Modifica sotto l'intestazione
  const B = await open({ browser, ls: {}, w: 320, h: 640 });
  await B.page.click('#planEditBtn'); await B.page.waitForTimeout(200);
  const pr = await B.page.evaluate(async () => {
    const main = document.querySelector('main'), hd = document.querySelector('header');
    const el = document.querySelector('#exList input[data-f="name"]');
    el.scrollIntoView({ block: 'start' }); main.scrollTop -= 3; await new Promise(r => setTimeout(r, 50));
    el.focus(); await new Promise(r => setTimeout(r, 80));
    return { top: Math.round(el.getBoundingClientRect().top), headerBottom: Math.round(hd.getBoundingClientRect().bottom) };
  });
  check(pr.top >= pr.headerBottom, 'Modifica scheda: campo toccato sotto l\'intestazione ' + JSON.stringify(pr));
  await browser.close();
})();
