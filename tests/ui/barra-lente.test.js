// barra come il giardino: pillola elastica (oltrepassa e torna), saltello dell'icona, tocco = un solo cambio, senza animazioni
const { chromium } = require('playwright');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const reduce of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: reduce ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://localhost:8888/', { waitUntil: 'load' }); await p.waitForTimeout(500);
    const tag = reduce ? '[senza animazioni] ' : '';
    const geo = () => p.evaluate(() => { const i = document.querySelector('.nav-ind').getBoundingClientRect(), b = document.querySelector('nav.bottom button.active').getBoundingClientRect(); return { il: +i.left.toFixed(1), iw: Math.round(i.width), bl: +b.left.toFixed(1), bw: Math.round(b.width) }; });
    const under = g => Math.abs(g.il - g.bl) <= 1.5 && Math.abs(g.iw - g.bw) <= 1.5;
    let g = await geo(); check(under(g), tag + 'all\'avvio sotto Allenamento ' + JSON.stringify(g));
    // conta i cambi di sezione
    await p.evaluate(() => { window.__sw = 0; document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => window.__sw++)); });
    // registra la posizione della pillola fotogramma per fotogramma
    await p.evaluate(() => { window.__xs = []; const f = () => { window.__xs.push(document.querySelector('.nav-ind').getBoundingClientRect().left); if (window.__xs.length < 60) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await p.tap('nav.bottom button[data-tab="month"]');
    await p.waitForTimeout(900);
    const xs = await p.evaluate(() => window.__xs); g = await geo();
    check(under(g), tag + 'tocco su Mese: pillola sotto Mese ' + JSON.stringify(g));
    check(await p.evaluate(() => window.__sw) === 1 && await p.evaluate(() => document.getElementById('tab-month').classList.contains('active')), tag + 'un tocco = un solo cambio di sezione');
    const max = Math.max(...xs);
    if (!reduce) {
      check(new Set(xs.map(x => Math.round(x))).size > 8 && max > g.bl + 2, 'scivola (' + new Set(xs.map(x => Math.round(x))).size + ' posizioni) e oltrepassa Mese di ' + (max - g.bl).toFixed(1) + ' px prima di tornare');
      check(await p.evaluate(() => document.querySelector('nav.bottom button.active .ic').getAnimations().length + getComputedStyle(document.querySelector('nav.bottom button.active .ic')).animationName) !== '0none', 'saltello dell\'icona');
    } else check(new Set(xs.map(x => Math.round(x))).size <= 2, '[senza animazioni] nessuno scivolamento: salta subito');
    // tocchi rapidi
    for (const t of ['plan', 'workout', 'stats']) { await p.tap(`nav.bottom button[data-tab="${t}"]`); await p.waitForTimeout(80); }
    await p.waitForTimeout(800); g = await geo();
    check(under(g) && await p.evaluate(() => window.__sw) === 4, tag + 'tocchi rapidi: finisce sotto Settimana, 4 cambi in tutto');
    // mouse/tastiera: click normale
    await p.click('nav.bottom button[data-tab="plan"]'); await p.waitForTimeout(800); g = await geo();
    check(under(g) && await p.evaluate(() => window.__sw) === 5, tag + 'click (senza tocco) funziona');
    await p.setViewportSize({ width: 320, height: 700 }); await p.waitForTimeout(700); g = await geo();
    check(under(g), tag + 'schermo stretto: allineata ' + JSON.stringify(g));
    const lbl = await p.evaluate(() => [...document.querySelectorAll('nav.bottom button')].map(b => b.scrollWidth <= b.clientWidth + 1));
    check(lbl.every(Boolean), tag + 'a 320 px le scritte ci stanno ' + JSON.stringify(lbl));
    if (!reduce) { await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '/barra.png', clip: { x: 0, y: 730, width: 390, height: 114 } }); }
    check(!errors.length, tag + 'nessun errore ' + errors.join('|'));
    await ctx.close();
  }
  await browser.close();
})();
