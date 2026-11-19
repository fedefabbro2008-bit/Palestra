// Sostituisci in tema scuro a 390 px e chiaro a 320 px: niente esce dallo schermo, ricerca e «nessun risultato» funzionano
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const [tag, light, w, h] of [['dark390', false, 390, 844], ['light320', true, 320, 640]]) {
    const A = await open({ browser, ls: {}, w, h });
    const p = A.page;
    await p.evaluate(seedLogs, { weeks: 3 });
    if (light) await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.dark = false; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
    await p.reload(); await p.waitForTimeout(400);
    // la giornata con la Lat machine (quella che tocca cambia col giorno della settimana in cui gira la prova)
    await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('palestra:days')); const k = Object.keys(d).find(k => !d[k].spare && d[k].exercises.some(e => /Lat machine/.test(e.name))); document.querySelector(`.day-pill[data-k="${k}"]`).click(); });
    await p.waitForTimeout(300);
    await p.click('#startSessionBtn'); await p.waitForTimeout(300);
    const ei = await p.evaluate(() => [...document.querySelectorAll('#sessList .sess-name-input')].findIndex(e => /Lat machine/.test(e.value)));
    await p.click(`.sess-sub-btn[data-ei="${ei}"]`); await p.waitForTimeout(400);
    // scorre fino agli altri esercizi comuni: la ricerca resta in cima
    await p.evaluate(() => { const sh = document.querySelector('#subSheet .sheet'); const g = document.querySelectorAll('#subList .sub-grp')[2]; sh.scrollTop = g.offsetTop - 40; });
    await p.waitForTimeout(250);
    await p.screenshot({ path: OUT + `/102-sub-scroll-${tag}.png` });
    await p.fill('#subSearch', 'rematore'); await p.waitForTimeout(150);
    await p.screenshot({ path: OUT + `/103-sub-search-${tag}.png` });
    await p.fill('#subSearch', 'zzzz'); await p.waitForTimeout(150);
    await p.screenshot({ path: OUT + `/104-sub-none-${tag}.png` });
    const ov = await p.evaluate(() => { const r = []; document.querySelectorAll('#subSheet *').forEach(el => { const b = el.getBoundingClientRect(); if (b.width && b.right > innerWidth + 1) r.push(el.className); }); return r.slice(0, 5); });
    const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!ov.length && !er.length, tag + ': niente fuori dallo schermo, nessun errore ' + JSON.stringify(ov));
    await A.ctx.close();
  }
  await browser.close();
})();
