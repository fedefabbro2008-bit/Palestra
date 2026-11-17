// «Serie per muscolo» con la figura del corpo scorrendo a destra (Settimana: 7 giorni, Mese: il mese) + costanza 6 mesi
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const fs = require('fs');
const OUT = process.argv[2], FILE = process.argv[3];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const runs = [['seed 30 settimane', null], ['backup reale', FILE]];
  for (const [nome, file] of runs) {
    console.log('--- ' + nome);
    let A;
    if (file) { const d = JSON.parse(fs.readFileSync(file, 'utf8')); A = await open({ ls: { 'palestra:days': d.days, 'palestra:logs': d.logs, 'palestra:settings': d.settings, 'palestra:fix-petto-1': '1' }, motion: true }); }
    else { A = await open({ ls: {}, motion: true }); await A.page.evaluate(seedLogs, { weeks: 30 }); await A.page.reload(); await A.page.waitForTimeout(500); }
    const p = A.page, cdp = await A.ctx.newCDPSession(p);
    const block = async (sel) => p.evaluate(sel => {
      const mf = document.querySelector(sel); if (!mf) return null;
      const got = {}; mf.querySelectorAll('.mf-figs .bd-m').forEach(el => { got[el.dataset.m] = el.getAttribute('class').replace(/bd-m|sel/g, '').trim(); });
      const rows = {}; mf.querySelectorAll('.m-mrow').forEach(r => { const n = +r.querySelector('.n').firstChild.textContent.trim(); rows[r.dataset.m] = n === 0 ? 'n0' : r.classList.contains('under') ? 'tu' : r.classList.contains('over') ? 'tv' : 'tk'; });
      const pages = mf.querySelector('.mf-pages');
      return { got, rows, page: Math.round(pages.scrollLeft / (pages.scrollWidth / 2)), tab: mf.querySelector('.mf-tabs .on').dataset.i };
    }, sel);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const swipe = async (sel, dir) => { const r = await p.evaluate(sel => { const b = document.querySelector(sel + ' .mf-pages').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 60 }; }, sel);
      const x0 = r.x + dir * 120; await touch('touchStart', x0, r.y); for (let i = 1; i <= 12; i++) { await touch('touchMove', x0 - dir * i * 20, r.y); await p.waitForTimeout(16); } await touch('touchEnd'); await p.waitForTimeout(900); };
    const same = b => Object.keys(b.rows).every(m => b.got[m] === b.rows[m]);
    for (const [t, sel] of [['stats', '#volList .mf'], ['month', '#monthBody .mf']]) {
      await tab(p, t); await p.waitForTimeout(500);
      let b = await block(sel);
      if (!b) { check(file && t === 'stats', t + ': nessun blocco (nessun allenamento nel periodo)'); continue; }
      check(b.page === 0 && b.tab === '0', t + ': si apre sull\'elenco');
      await p.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'start' }), sel); await p.waitForTimeout(200);
      await swipe(sel, 1);
      b = await block(sel);
      check(b.page === 1 && b.tab === '1', t + ': scorrendo a destra col dito compare il corpo, linguetta «Corpo» accesa');
      check(Object.keys(b.rows).length >= 8 && same(b), t + ': colori della figura = elenco (' + Object.entries(b.rows).map(([m, c]) => m + ':' + c + (b.got[m] !== c ? '≠' + b.got[m] : '')).join(' ') + ')');
      const m = Object.keys(b.rows).find(k => b.rows[k] !== 'n0');
      if (m) {
        await p.click(`${sel} .mf-figs .bd-m[data-m="${m}"] >> nth=0`); await p.waitForTimeout(400);
        const det = (await p.textContent(sel + ' .mf-det')).replace(/\s+/g, ' ');
        const num = await p.evaluate(([sel, m]) => document.querySelector(`${sel} .m-mrow[data-m="${m}"] .n`).firstChild.textContent.trim(), [sel, m]);
        check(det.includes(m) && det.includes(num + ' serie'), t + ': tocco su ' + m + ' → ' + det.slice(0, 90) + ' (elenco: ' + num + ')');
        if (!file) await p.locator(sel).screenshot({ path: `${OUT}/mf-${t}.png` });
      }
      await swipe(sel, -1);
      b = await block(sel);
      check(b.page === 0 && b.tab === '0', t + ': scorrendo a sinistra torna l\'elenco');
      await p.click(sel + ' .mf-tabs button[data-i="1"]'); await p.waitForTimeout(700);
      b = await block(sel);
      check(b.page === 1 && b.tab === '1', t + ': tocco su «Corpo» porta alla figura');
      if (t === 'month') {
        await p.click('#monthPrev'); await p.waitForTimeout(600);
        b = await block(sel);
        check(b && b.page === 1 && b.tab === '1', 'mese precedente: resta sul corpo');
        await p.click('#monthNext'); await p.waitForTimeout(400);
      }
    }
    check(!(await p.$('#trainCard')), 'il riquadro separato non c\'è più');
    // ---- costanza
    await tab(p, 'month'); await p.waitForTimeout(400);
    const sk = await p.evaluate(() => { const g = document.querySelector('#streakGrid .sk-grid'); return g ? g.querySelectorAll('.sk-c').length : 0; });
    check(sk === 182, 'costanza: ancora 182 quadretti');
    check(!A.errors.filter(x => !/Service Worker|404/.test(x)).length, 'nessun errore ' + A.errors.filter(x => !/Service Worker|404/.test(x)).join('|'));
    await A.browser.close();
  }
})();
