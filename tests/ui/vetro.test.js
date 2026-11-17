// vetro liquido come iOS 26 (in CSS): bordo di luce sui comandi che galleggiano (barra, timer, pulsanti in alto, avvisi,
// lenti), luce che segue il dito e si spegne quando lasci, interruttore che diventa una lente, barre in alto con il
// bordo che sfuma. Misure invariate; niente con animazioni spente, risparmio energetico o «Riduci trasparenza»
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const css = (p, sel, prop, pseudo) => p.evaluate(([s, pr, ps]) => { const e = document.querySelector(s); return e ? getComputedStyle(e, ps || null).getPropertyValue(pr) : null; }, [sel, prop, pseudo]);
const boxes = p => p.evaluate(() => ['header', 'nav.bottom', '#settingsBtn', '#timerBar', '.session-topbar', 'main'].map(s => { const e = document.querySelector(s); if (!e || !e.offsetParent) return s + ':-'; const r = e.getBoundingClientRect(); return s + ':' + [r.x, r.y, r.width, r.height].map(Math.round).join(','); }).join(' '));
async function press(p, sel, fx, fy) {
  const b = await (await p.$(sel)).boundingBox();
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(200);
  return { x, y, b };
}
const lightState = (p, sel) => p.evaluate(s => { const h = document.querySelector(s), box = h && h.querySelector(':scope > .lg-lights'); if (!box) return null;
  const d = box.firstElementChild, m = new DOMMatrix(getComputedStyle(d).transform), r = h.getBoundingClientRect();
  return { on: box.classList.contains('on'), op: +getComputedStyle(d).opacity, x: m.m41 + r.left, y: m.m42 + r.top, pe: getComputedStyle(box).pointerEvents }; }, sel);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 4 }); await p.reload(); await p.waitForTimeout(600);

  // 1. materiale
  check(!/none/.test(await css(p, 'nav.bottom', 'backdrop-filter')), 'barra in basso: sfocata (vetro)');
  for (const s of ['nav.bottom', '#settingsBtn', '.nav-ind', '.toast']) check((await css(p, s, 'content', '::after')) === '""' && (await css(p, s, 'pointer-events', '::after')) === 'none', `${s}: bordo di luce, non intercetta i tocchi`);
  check((await css(p, '#settingsBtn', 'border-radius')) === '50%' && !/none/.test(await css(p, '#settingsBtn', 'backdrop-filter')), 'pulsante Impostazioni: tondo e di vetro');
  check(!/none/.test(await css(p, 'header', 'backdrop-filter', '::before')) && (await css(p, 'header', 'border-bottom-color')) === 'rgba(0, 0, 0, 0)', 'barra in alto: niente riga netta, vetro che sfuma');
  // misure invariate rispetto alla pagina senza vetro liquido
  const b1 = await boxes(p);
  const b0 = await p.evaluate(() => { const ls = [...document.querySelectorAll('.lg')]; ls.forEach(e => e.classList.remove('lg', 'lg-i', 'lg-btn')); const st = document.createElement('style'); st.id = 'nolg'; st.textContent = 'header::before,.session-topbar::before{display:none!important}'; document.head.appendChild(st);
    const out = ['header', 'nav.bottom', '#settingsBtn', '#timerBar', '.session-topbar', 'main'].map(s => { const e = document.querySelector(s); if (!e || !e.offsetParent) return s + ':-'; const r = e.getBoundingClientRect(); return s + ':' + [r.x, r.y, r.width, r.height].map(Math.round).join(','); }).join(' '); return out; });
  check(b0 === b1, 'misure di barre e pulsanti uguali a prima (' + b1 + ')');
  await p.reload(); await p.waitForTimeout(500);

  // 2. luce del tocco: si accende dove tocchi, segue il dito, si spegne quando lasci
  const t = await press(p, 'nav.bottom', 0.62, 0.5);
  let L = await lightState(p, 'nav.bottom');
  check(L && L.on && L.op > 0.5 && Math.abs(L.x - t.x) < 3 && Math.abs(L.y - t.y) < 3 && L.pe === 'none', 'barra premuta: luce accesa sotto il dito');
  await p.mouse.move(t.x - 60, t.y, { steps: 4 }); await p.waitForTimeout(120);
  L = await lightState(p, 'nav.bottom');
  check(L && Math.abs(L.x - (t.x - 60)) < 3, 'la luce segue il dito');
  await p.mouse.up(); await p.waitForTimeout(700);
  L = await lightState(p, 'nav.bottom');
  check(L && !L.on && L.op < 0.05, 'lasciato: la luce si spegne');
  check(await p.evaluate(() => document.querySelectorAll('nav.bottom > .lg-lights').length === 1), 'una sola luce per comando (non se ne aggiungono a ogni tocco)');
  // pulsante di vetro: premuto si gonfia
  await press(p, '#settingsBtn', 0.5, 0.5); await p.waitForTimeout(250);
  const sc = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('settingsBtn')).transform).a);
  check(sc > 1.05, `pulsante di vetro premuto: si gonfia (×${sc.toFixed(2)})`);
  await p.mouse.up(); await p.waitForTimeout(800);
  // interruttore premuto: il pallino diventa una lente più grande
  const sw = await p.$('#settingsSheet .switch'); await sw.scrollIntoViewIfNeeded();
  const sb = await sw.boundingBox(); await p.mouse.move(sb.x + 10, sb.y + sb.height / 2); await p.mouse.down(); await p.waitForTimeout(500);
  const kn = await p.evaluate(() => { const k = document.querySelector('#settingsSheet .switch .knob'); return { s: new DOMMatrix(getComputedStyle(k).transform).a, bg: getComputedStyle(k).backgroundColor }; });
  check(kn.s > 1.15 && /rgba\(255, 255, 255/.test(kn.bg), `interruttore premuto: pallino di vetro più grande (×${kn.s.toFixed(2)})`);
  await p.mouse.up(); await p.waitForTimeout(300);
  await p.keyboard.press('Escape'); await p.reload(); await p.waitForTimeout(500);

  // 3. allenamento: timer e barra in alto; il bordo dei pulsanti del timer resta sui pulsanti
  await p.click('#startSessionBtn'); await p.waitForTimeout(400);
  for (let i = 0; i < 12 && !(await p.isVisible('#timerBar.show')); i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(90); }
  check(await p.isVisible('#timerBar.show') && (await css(p, '#timerBar', 'content', '::after')) === '""', 'timer: capsula col bordo di luce');
  check((await css(p, '#tbPause', 'position')) === 'relative' && (await css(p, '#tbStop', 'position')) === 'relative', 'bordo dei pulsanti del timer sopra i pulsanti, non su tutta la barra');
  check((await css(p, '.session-topbar', 'border-bottom-color')) === 'rgba(0, 0, 0, 0)' && (await css(p, '#sessCancelBtn', 'border-radius')) === '50%', 'barra dell\'allenamento: bordo che sfuma, pulsante tondo di vetro');
  const tl = await press(p, '#timerBar', 0.3, 0.5); L = await lightState(p, '#timerBar');
  check(L && L.on && Math.abs(L.x - tl.x) < 3, 'timer premuto: luce sotto il dito');
  await p.mouse.up(); await p.waitForTimeout(400);
  await p.keyboard.press('Escape').catch(() => {});
  const errs = A.errors.filter(e => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.ctx.close();

  // 4. «Riduci movimento»: niente luce e niente rigonfiamento
  const B = await open({ browser: A.browser, ls: {}, motion: false });
  await press(B.page, 'nav.bottom', 0.62, 0.5);
  check(!(await lightState(B.page, 'nav.bottom')), 'Riduci movimento: nessuna luce al tocco');
  await B.page.mouse.up(); await B.ctx.close();

  // 5. risparmio energetico: niente vetro, riflessi e luci
  const C = await open({ browser: A.browser, ls: { 'palestra:settings': { eco: 'on' } }, motion: true }), c = C.page;
  check(/none/.test(await css(c, 'nav.bottom', 'backdrop-filter')) && (await css(c, 'nav.bottom', 'display', '::after')) === 'none' && (await css(c, 'header', 'display', '::before')) === 'none', 'risparmio energetico: niente vetro, bordo di luce e sfumatura');
  await press(c, 'nav.bottom', 0.62, 0.5);
  check(!(await lightState(c, 'nav.bottom')), 'risparmio energetico: nessuna luce al tocco');
  await c.mouse.up(); await C.ctx.close();

  // 6. «Riduci trasparenza»: barre e pulsanti pieni
  const D = await open({ browser: A.browser, ls: {}, motion: true }), d = D.page;
  const cdp = await D.ctx.newCDPSession(d);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const rt = await d.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
  if (rt) check(/none/.test(await css(d, 'header', 'backdrop-filter', '::before')) && /none/.test(await css(d, '#settingsBtn', 'backdrop-filter')) && /none/.test(await css(d, 'nav.bottom', 'backdrop-filter')), 'Riduci trasparenza: barre e pulsanti pieni');
  else console.log('(questo Chromium non simula «Riduci trasparenza»: controllo saltato)');
  await A.browser.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
