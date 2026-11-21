// serie successiva illuminata: sempre in avanti (stesso esercizio, poi i successivi; nel superset il giro dopo), mai indietro
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(500);
  await p.click('#startSessionBtn'); await p.waitForTimeout(700);
  // registra quale riga si illumina
  await p.evaluate(() => { window.__glow = []; new MutationObserver(ms => ms.forEach(m => { const t = m.target; if (t.classList && t.classList.contains('next-glow')) { const c = t.querySelector('.check'); window.__glow.push(c.dataset.ei + ':' + c.dataset.si); } })).observe(document.getElementById('sessList'), { attributes: true, subtree: true, attributeFilter: ['class'] }); });
  const tick = async (ei, si) => { await p.evaluate(() => { window.__glow = []; }); await p.click(`#sessList .check[data-ei="${ei}"][data-si="${si}"]`); await p.waitForTimeout(700); return p.evaluate(() => window.__glow[window.__glow.length - 1] || 'nessuna'); };
  const S = () => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')).exercises.map(x => ({ n: x.name.slice(0, 16), link: !!x.linkNext, sets: x.sets.map(s => (s.warm ? 'w' : '') + (s.done ? 'x' : 'o')) })));
  let ex = await S();
  // primo esercizio a sé con almeno 3 serie, non in superset
  const ei = ex.findIndex((x, i) => !x.link && !(i > 0 && ex[i - 1].link) && x.sets.filter(s => !s.startsWith('w')).length >= 3);
  const work = ex[ei].sets.map((s, si) => ({ s, si })).filter(o => !o.s.startsWith('w')).map(o => o.si);
  // apre l'esercizio se richiuso
  await p.evaluate(ei => { const c = document.querySelector(`#sessList .check[data-ei="${ei}"]`); if (c && !c.offsetHeight) { const h = c.closest('.sess-ex').querySelector('.sess-ex-head, .sess-head'); if (h) h.click(); } }, ei);
  await p.waitForTimeout(400);
  // salto la prima serie di lavoro e spunto la seconda: si illumina la terza, non la prima rimasta indietro
  let g = await tick(ei, work[1]);
  check(g === ei + ':' + work[2], `${ex[ei].n}: spuntata la serie ${work[1] + 1} saltando la ${work[0] + 1} → si illumina ${g} (atteso ${ei}:${work[2]})`);
  // spunto l'ultima serie dell'esercizio: si illumina il primo da fare dell'esercizio dopo
  const last = work[work.length - 1];
  for (const si of work.slice(2, -1)) await tick(ei, si);
  g = await tick(ei, last);
  ex = await S();
  const nextEi = ei + 1, nextSi = ex[nextEi].sets.findIndex(s => s.endsWith('o'));
  check(g === nextEi + ':' + nextSi || g === 'nessuna', `ultima serie di ${ex[ei].n} (con la ${work[0] + 1} ancora da fare) → ${g} (atteso ${nextEi}:${nextSi}, l'esercizio dopo)`);
  check(g !== ei + ':' + work[0], 'mai la serie rimasta indietro');
  // superset
  ex = await S();
  const a = ex.findIndex((x, i) => x.link && i < ex.length - 1);
  if (a >= 0) {
    const wa = ex[a].sets.map((s, si) => ({ s, si })).filter(o => !o.s.startsWith('w')).map(o => o.si), wb = ex[a + 1].sets.map((s, si) => ({ s, si })).filter(o => !o.s.startsWith('w')).map(o => o.si);
    await p.evaluate(ei => { const c = document.querySelector(`#sessList .check[data-ei="${ei}"]`); if (c && !c.offsetHeight) { const h = c.closest('.sess-ex').querySelector('.sess-ex-head, .sess-head'); if (h) h.click(); } }, a);
    await p.waitForTimeout(400);
    g = await tick(a, wa[0]);
    check(g === (a + 1) + ':' + wb[0], `superset ${ex[a].n} + ${ex[a + 1].n}: dopo la 1ª di A si illumina la 1ª di B (${g})`);
    g = await tick(a + 1, wb[0]);
    check(g === a + ':' + wa[1], `poi la 2ª di A (${g})`);
  } else console.log('(nessun superset in questa giornata)');
  check(!A.errors.filter(x => !/Service Worker|404/.test(x)).length, 'nessun errore ' + A.errors.filter(x => !/Service Worker|404/.test(x)).join('|'));
  await A.browser.close();
})();
