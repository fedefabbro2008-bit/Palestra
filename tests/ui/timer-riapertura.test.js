// riapertura dell'app con un recupero salvato: finito da poco (avviso), finito da ore (niente), ancora in corso (barra con il tempo giusto)
const { chromium } = require('playwright');
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const [what, endOff] of [['finito 30 s fa', -30e3], ['finito 3 ore fa', -3 * 3600e3], ['finisce tra 40 s', 40e3]]) {
    const C = await open({ browser, ls: { 'palestra:timer': JSON.stringify({ label: 'Panca', duration: 90, remaining: 90, running: true, paused: false, notified: false, endAt: Date.now() + endOff }) } });
    const toast = await C.page.textContent('#toastMsg'), bar = await C.page.isVisible('#timerBar.show'), tt = await C.page.textContent('#tbTime'), er = C.errors.filter(e => !/Service Worker|404/.test(e));
    const ok = endOff === -30e3 ? (/già terminato/.test(toast) && !bar) : endOff < 0 ? (!toast && !bar) : (bar && /^0:(39|40)$/.test(tt));
    check(ok && !er.length, what + ': ' + (bar ? 'barra ' + tt : 'nessuna barra') + (toast ? ', avviso «' + toast + '»' : ''));
    await C.ctx.close();
  }
  await browser.close();
})();
