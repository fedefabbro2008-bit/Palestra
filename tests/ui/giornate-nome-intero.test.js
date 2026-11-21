// Giornate in alto: il nome si legge sempre intero. Con 4-5 giornate (o su un telefono stretto) «Mercoledì» diventava
// «Mercol…»: ora ogni pillola è larga almeno quanto il suo nome (il sottotitolo non la allarga). Con 3 giornate su
// un iPhone normale la riga resta uguale a prima (stessa larghezza per tutte, senza scorrere); con tante la riga
// scorre e la lente sta sulla giornata scelta
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  let browser = null;
  const row = (p) => p.evaluate(() => { const w = document.getElementById('dayPills'), a = w.querySelector('.day-pill.active'), ind = w.querySelector('.dp-ind');
    const pills = [...w.querySelectorAll('.day-pill[data-k]')].map((x) => { const k = x.querySelector('.dp-key'); return { name: k.textContent, w: x.getBoundingClientRect().width, cut: k.scrollWidth > k.clientWidth + 1 }; });
    const ar = a && a.getBoundingClientRect(), ir = ind && ind.getBoundingClientRect(), wr = w.getBoundingClientRect();
    return { fits: w.classList.contains('fits'), pills, lens: a && ind ? Math.abs(ir.left - ar.left) + Math.abs(ir.width - ar.width) : null, activeIn: a ? ar.left >= wr.left - 1 && ar.right <= wr.right + 1 : true }; });
  const desc = (r) => r.pills.map((x) => x.name + ' ' + Math.round(x.w) + (x.cut ? '✂' : '')).join(' | ');
  for (const [w, extra] of [[390, 0], [375, 0], [390, 1], [390, 2]]) {
    const A = await open({ browser, ls: {}, w }), p = A.page; browser = A.browser;
    await p.evaluate(seedLogs, { weeks: 3 });
    await p.evaluate((extra) => { const d = JSON.parse(localStorage.getItem('palestra:days')); const ex = Object.values(d)[0].exercises.slice(0, 2);
      if (extra >= 1) d.D = { name: 'Giovedì pomeriggio · Casa', exercises: ex }; if (extra >= 2) d.E = { name: 'Sabato · Braccia', exercises: ex };
      localStorage.setItem('palestra:days', JSON.stringify(d)); }, extra);
    await p.reload(); await p.waitForTimeout(600);
    const r = await row(p), n = r.pills.length, tag = `${w} px, ${n} giornate`;
    check(r.pills.every((x) => !x.cut), `${tag}: nomi interi (${desc(r)})`);
    if (n === 3 && w === 390) check(r.fits && Math.max(...r.pills.map((x) => x.w)) - Math.min(...r.pills.map((x) => x.w)) < 1, `${tag}: come prima, tutte larghe uguali e senza scorrere`);
    if (n > 3) check(!r.fits && r.lens !== null && r.lens < 1.5 && r.activeIn, `${tag}: la riga scorre, la lente è sulla giornata scelta e si vede (scarto ${r.lens && r.lens.toFixed(1)} px)`);
    const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
    if (errs.length) check(false, tag + ': errori ' + errs.join(' | '));
    await A.ctx.close();
  }
  await browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
