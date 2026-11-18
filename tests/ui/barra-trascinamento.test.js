// barra in basso, lente afferrata come su WhatsApp: tenuta si solleva; trascinata segue il dito con ritardo elastico e si
// allunga con la velocità (con misura: al massimo 1,32 volte; al tocco lontano 1,5); al rilascio va sulla sezione più vicina (un solo cambio); tocco e click normali invariati
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.waitForTimeout(400);
  const cdp = await A.ctx.newCDPSession(p);
  await p.evaluate(() => { window.__sw = 0; document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => window.__sw++)); });
  const c = async t => p.evaluate(t => { const r = document.querySelector(`nav.bottom button[data-tab="${t}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }, t);
  const lens = () => p.evaluate(() => { const r = document.querySelector('nav.bottom .nav-ind').getBoundingClientRect(); return { cx: r.x + r.width / 2, w: r.width, h: r.height }; });
  const active = () => p.evaluate(() => document.querySelector('nav.bottom button.active').dataset.tab);
  const sw = () => p.evaluate(() => window.__sw);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const a = await c('workout'), s = await c('stats'), m = await c('month'), pl = await c('plan');
  // 1. tenuta ferma sulla sezione scelta: si solleva
  await touch('touchStart', a.x, a.y); await p.waitForTimeout(350);
  let l = await lens();
  check(l.h > a.h + 6 && Math.abs(l.cx - a.x) < 1.5, 'tenendo premuto sulla sezione scelta la lente si solleva (alta ' + Math.round(l.h) + ' contro ' + Math.round(a.h) + ')');
  // 2. trascinamento lento verso Mese: segue con un filo di ritardo, poi raggiunge il dito
  const lag = [];
  for (let i = 1; i <= 12; i++) { const x = a.x + (m.x - a.x) * i / 12; await touch('touchMove', x, a.y); await p.waitForTimeout(16); lag.push(Math.round(x - (await lens()).cx)); }
  check(lag.some(d => d > 2), 'mentre il dito si muove la lente lo insegue con un leggero ritardo (ritardi: ' + lag.join(',') + ')');
  await p.waitForTimeout(350); l = await lens();
  check(Math.abs(l.cx - m.x) < 2, 'fermando il dito la lente lo raggiunge (scarto ' + (l.cx - m.x).toFixed(1) + ' px)');
  check(await sw() === 0, 'durante il trascinamento la sezione non cambia ancora');
  // 3. movimento veloce: si allunga
  let maxW = 0;
  for (let i = 1; i <= 6; i++) { await touch('touchMove', m.x + (pl.x - m.x) * i / 6, a.y); await p.waitForTimeout(12); maxW = Math.max(maxW, (await lens()).w); }
  for (let i = 5; i >= 0; i--) { await touch('touchMove', m.x + (pl.x - m.x) * i / 6, a.y); await p.waitForTimeout(12); maxW = Math.max(maxW, (await lens()).w); }
  await p.waitForTimeout(400); l = await lens();
  check(maxW > (a.w + 6) * 1.1 && maxW <= (a.w + 6) * 1.33 && l.w < (a.w + 6) * 1.04, 'veloce si allunga ma con misura (larga fino a ' + Math.round(maxW) + ', al massimo ' + Math.round((a.w + 6) * 1.33) + '), ferma si ricompone (' + Math.round(l.w) + ')');
  // 4. rilascio su Mese
  await touch('touchEnd'); await p.waitForTimeout(800);
  l = await lens();
  check(await active() === 'month' && await sw() === 1, 'al rilascio: Mese, un solo cambio di sezione');
  check(Math.abs(l.cx - m.x) < 1.5 && Math.abs(l.h - m.h) < 1.5, 'la lente si posa su Mese e torna alla sua misura');
  // 5. trascinata e riportata indietro: nessun cambio
  await touch('touchStart', m.x, m.y); for (let i = 1; i <= 5; i++) { await touch('touchMove', m.x + 14 * i, m.y); await p.waitForTimeout(20); } for (let i = 4; i >= 0; i--) { await touch('touchMove', m.x + 14 * i, m.y); await p.waitForTimeout(20); }
  await p.waitForTimeout(250); await touch('touchEnd'); await p.waitForTimeout(800);
  check(await sw() === 1 && await active() === 'month' && Math.abs((await lens()).cx - m.x) < 1.5 && Math.abs((await lens()).h - m.h) < 1.5, 'trascinata e riportata su Mese: nessun cambio, si riposa lì');
  // 6. tocco semplice su un'altra sezione
  await touch('touchStart', pl.x, pl.y); await touch('touchEnd'); await p.waitForTimeout(800);
  check(await active() === 'plan' && await sw() === 2 && Math.abs((await lens()).cx - pl.x) < 1.5, 'tocco semplice: Progressi, un cambio, lente al suo posto');
  // 7. tocco sulla sezione già scelta: non cambia, la lente torna a riposo
  await touch('touchStart', pl.x, pl.y); await p.waitForTimeout(150); await touch('touchEnd'); await p.waitForTimeout(800);
  l = await lens();
  check(await active() === 'plan' && Math.abs(l.h - pl.h) < 1.5, 'tocco sulla sezione già scelta: resta, la lente torna giù');
  // 8. mouse: click normale e trascinamento
  await p.mouse.click(s.x, s.y); await p.waitForTimeout(800);
  check(await active() === 'stats' && await sw() === 4, 'click col mouse: Settimana');
  await p.mouse.move(s.x, s.y); await p.mouse.down(); for (let i = 1; i <= 10; i++) { await p.mouse.move(s.x + (pl.x - s.x) * i / 10, s.y); await p.waitForTimeout(16); } await p.waitForTimeout(300); await p.mouse.up(); await p.waitForTimeout(800);
  check(await active() === 'plan' && await sw() === 5, 'trascinamento col mouse: Progressi, un cambio');
  // 9. tocco lontano (Progressi → Allenamento): a metà strada la lente si allunga, ma al massimo 1,5 volte la sua misura sollevata
  await p.evaluate(() => { const ind = document.querySelector('nav.bottom .nav-ind'); window.__mw = 0; let n = 0;
    const f = () => { window.__mw = Math.max(window.__mw, ind.getBoundingClientRect().width); if (++n < 60) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.waitForTimeout(300); await touch('touchStart', a.x, a.y); await touch('touchEnd'); await p.waitForTimeout(1100);
  const tw = await p.evaluate(() => window.__mw);
  check(await active() === 'workout' && tw > (a.w + 6) * 1.15 && tw <= (a.w + 6) * 1.53, 'dopo il mouse il dito funziona; tocco lontano: si allunga a metà strada ma con misura (larga fino a ' + Math.round(tw) + ', al massimo ' + Math.round((a.w + 6) * 1.53) + ')');
  check(!A.errors.filter(x => !/Service Worker|404/.test(x)).length, 'nessun errore ' + A.errors.filter(x => !/Service Worker|404/.test(x)).join('|'));
  await A.browser.close();
})();
