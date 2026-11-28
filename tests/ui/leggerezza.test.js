// leggerezza: conteggi (non millisecondi, che variano da un giro all'altro) del lavoro che il telefono fa
// - recupero con la finestra del timer chiusa: pagina ferma (l'anello si anima solo a finestra aperta, dal punto giusto)
// - timer che compare a ogni serie: non si ricalcola lo stile di tutta la lista (altezze delle barre solo su main)
// - avvio: un solo ricalcolo grande (caratteri pronti al primo disegno)
// - spunta: evidenziazione della serie dopo e barra in alto solo con opacità/spostamento
// - nessun :has() sulla radice (in tema scuro scorreva tutta la pagina a ogni ricalcolo)
const { chromium } = require('playwright');
const { open, BASE } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
async function trace(browser, p, fn) {
  await browser.startTracing(p, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await fn();
  const ev = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
  const styles = ev.filter(e => e.name === 'UpdateLayoutTree' && e.args && e.args.elementCount != null).map(e => e.args.elementCount);
  return { frames: ev.filter(e => e.name === 'Commit').length, styles, maxStyle: Math.max(0, ...styles), sumStyle: styles.reduce((a, b) => a + b, 0) };
}
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 8 });
  await p.reload(); await p.waitForTimeout(2500);

  // 1. avvio: niente secondo ricalcolo di tutta la pagina
  const tot0 = await p.evaluate(() => document.getElementsByTagName('*').length);
  const st = await trace(browser, p, async () => { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800); });
  check(st.sumStyle < tot0 * 0.45, `avvio: elementi ricalcolati in tutto ${st.sumStyle} su ${tot0} (prima circa il 70%)`);
  // radice: niente :has(), classe del tema anche su html
  const css = await p.evaluate(() => [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n'));
  check(!/html:has\(/.test(css), 'nessun html:has(...) nello stile');

  // 1b. barra: al tocco la lente parte subito e la sezione nuova si prepara nel fotogramma dopo (il lavoro pesante non
  // fa partire la lente in ritardo); un cambio chiesto dal codice resta immediato
  await p.evaluate(() => { window.__o = null; const ind = document.querySelector('nav.bottom .nav-ind');
    document.querySelector('nav.bottom').addEventListener('touchstart', () => { const poll = () => { const a = ind.getAnimations()[0];
      if (a && window.__o == null) window.__o = document.getElementById('tab-stats').classList.contains('active') ? 'sezione prima della lente' : 'lente prima della sezione';
      if (window.__o == null) setTimeout(poll, 0); }; setTimeout(poll, 0); }, { once: true, capture: true }); });
  await p.tap('nav.bottom button[data-tab="stats"]'); await p.waitForTimeout(700);
  const ord = await p.evaluate(() => window.__o), statsOn = await p.evaluate(() => document.getElementById('tab-stats').classList.contains('active'));
  check(ord === 'lente prima della sezione' && statsOn, 'tocco sulla barra: la lente parte prima che la sezione si prepari, poi la sezione c\'è (' + ord + ')');
  const direct = await p.evaluate(() => { document.querySelector('nav.bottom button[data-tab="workout"]').click(); return document.getElementById('tab-workout').classList.contains('active'); });
  check(direct, 'cambio di sezione dal codice: immediato');
  await p.waitForTimeout(600);

  // 2. altezze delle barre solo su main, non ereditate
  const vars = await p.evaluate(() => { const m = document.querySelector('main'), c = m.querySelector('.card') || m.firstElementChild; return { main: getComputedStyle(m).getPropertyValue('--head-h'), root: getComputedStyle(document.documentElement).getPropertyValue('--head-h'), child: getComputedStyle(c).getPropertyValue('--head-h') }; });
  check(/px/.test(vars.main) && !vars.root && !vars.child, `altezze delle barre solo su main (${JSON.stringify(vars)})`);

  // 3. allenamento: inizio senza doppio ricalcolo, timer che compare senza ricalcolare tutta la lista
  const sIn = await trace(browser, p, async () => { await p.click('#startSessionBtn'); await p.waitForTimeout(900); });
  const list = await p.evaluate(() => document.querySelectorAll('#sessionView *').length);
  const big = sIn.styles.filter(n => n > list * 0.4);
  check(big.length === 1, `inizio allenamento: un solo ricalcolo grande (${big.join(', ')} elementi su ${list}; prima due)`);
  let shown = false, worst = 0;
  for (let i = 0; i < 12 && !shown; i++) {
    const r = await trace(browser, p, async () => { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(500); });
    shown = await p.isVisible('#timerBar.show'); worst = Math.max(worst, r.maxStyle);
  }
  check(shown && worst < list * 0.5, `spunte fino al timer: ricalcolo più grande ${worst} elementi su ${list} (prima tutta la lista)`);

  // 4. spunta: solo opacità e spostamento per evidenziazione e barra
  const an = await p.evaluate(() => {
    const prog = getComputedStyle(document.getElementById('sessProgress'));
    return { prog: prog.transitionProperty + '|' + prog.width + '|' + prog.transform };
  });
  check(/transform/.test(an.prog) && !/width/.test(an.prog.split('|')[0]), 'barra di avanzamento in alto: si sposta (transform), non si allarga: ' + an.prog);
  await p.click('.sess-set-row.next .check');
  const glow = await p.waitForFunction(() => { const a = document.getAnimations().find(x => x.animationName === 'nextGlow'); if (!a) return null; return { pseudo: a.effect.pseudoElement || '', props: a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(k => !/^(offset|easing|composite|computedOffset)$/.test(k)) }; }, null, { timeout: 3000, polling: 50 }).then(h => h.jsonValue()).catch(() => null);
  check(glow && glow.pseudo === '::after' && glow.props.every(k => k === 'opacity'), 'serie dopo illuminata: solo opacità di un velo ' + JSON.stringify(glow));
  await p.waitForTimeout(1200);

  // 5. recupero con la finestra chiusa: pagina ferma; aperta: anello continuo dal punto giusto; richiusa: fermo
  if (!(await p.isVisible('#timerBar.show'))) { for (let i = 0; i < 6 && !(await p.isVisible('#timerBar.show')); i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(300); } }
  await p.waitForTimeout(600);
  const rest = await trace(browser, p, () => p.waitForTimeout(3000));
  const ringClosed = await p.evaluate(() => document.getElementById('timerRing').getAnimations().filter(a => a.playState === 'running').length);
  check(rest.frames <= 40 && ringClosed === 0, `recupero a finestra chiusa: ${rest.frames} fotogrammi in 3 s (prima ~180), anello fermo`);
  const ring = () => p.evaluate(() => { const r = document.getElementById('timerRing'), t = JSON.parse(localStorage.getItem('palestra:timer')); const C = 2 * Math.PI * 54; return { run: r.getAnimations().filter(a => a.playState === 'running').length, off: parseFloat(getComputedStyle(r).strokeDashoffset), exp: C * ((t.endAt - Date.now()) / 1000 / t.duration) }; });
  await p.click('#timerBar'); await p.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const r1 = await ring(); await p.waitForTimeout(600); const r2 = await ring();
  check(r1.run === 1 && Math.abs(r1.off - r1.exp) < 4 && r2.off < r1.off - 1, `finestra aperta: anello continuo dal punto giusto (${r1.off.toFixed(1)} atteso ${r1.exp.toFixed(1)}, poi ${r2.off.toFixed(1)})`);
  await p.click('#timerClose'); await p.waitForTimeout(700);
  check(await p.evaluate(() => document.getElementById('timerRing').getAnimations().every(a => a.playState !== 'running')), 'finestra richiusa: anello fermo');

  // tema chiaro: la radice ha la sua classe e lo sfondo bianco (senza :has); scuro: niente classe, sfondo nero
  const root = () => p.evaluate(() => ({ cls: document.documentElement.classList.contains('light'), bg: getComputedStyle(document.documentElement).backgroundColor }));
  const dark = await root();
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.dark = false; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(500);
  const light = await root();
  check(!dark.cls && dark.bg === 'rgb(0, 0, 0)' && light.cls && light.bg === 'rgb(255, 255, 255)', `sfondo della radice dal tema con una classe (scuro ${JSON.stringify(dark)}, chiaro ${JSON.stringify(light)})`);
  const errs = A.errors.filter(e => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
