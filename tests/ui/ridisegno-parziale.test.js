// ridisegno parziale dell'allenamento: le schede non toccate restano le stesse (coi comandi che funzionano), la pagina
// è identica a quella di un ridisegno completo
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const sess = p => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')));
// fotografia dell'elenco senza gli effetti passeggeri
const snap = p => p.evaluate(() => { const c = document.getElementById('sessList').cloneNode(true); c.querySelectorAll('.just-done,.pr-new,.pulse,.ex-done,.next-glow').forEach(e => e.classList.remove('just-done', 'pr-new', 'pulse', 'ex-done', 'next-glow')); c.querySelectorAll('[class]').forEach(e => e.setAttribute('class', e.getAttribute('class').trim().split(/\s+/).join(' '))); c.querySelectorAll('[style]').forEach(e => e.removeAttribute('style')); c.querySelectorAll('input').forEach(e => e.setAttribute('value', e.value)); return c.innerHTML; });
const tag = p => p.evaluate(() => document.querySelectorAll('#sessList .sess-ex').forEach((e, i) => { e.__t = 'n' + i; }));
const kept = p => p.evaluate(() => [...document.querySelectorAll('#sessList .sess-ex')].filter(e => e.__t).length);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#dayPills .day-pill >> nth=0'); await p.waitForTimeout(150);
  await p.click('#startSessionBtn'); await p.waitForTimeout(700);
  const n = await p.$$eval('#sessList .sess-ex', l => l.length);
  // 1. una spunta: cambia una scheda sola
  await tag(p);
  await p.click('.sess-set-row.next .check'); await p.waitForTimeout(500);
  const k1 = await kept(p);
  check(k1 >= n - 2, `dopo una spunta restano ${k1} schede su ${n} (le altre sono state rifatte)`);
  // 2. pagina identica a un ridisegno completo
  const partial = await snap(p);
  await p.reload(); await p.waitForTimeout(900);
  const full = await snap(p);
  check(partial === full, 'elenco identico a quello di un ridisegno completo');
  // 3. molte spunte di fila, poi confronto di nuovo; stato salvato coerente
  for (let i = 0; i < 9; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(90); }
  await p.click('#tbStop').catch(() => {}); await p.waitForTimeout(500);
  const s1 = await sess(p), done = s1.exercises.flatMap(x => x.sets).filter(s => s.done).length;
  const rowsDone = await p.$$eval('#sessList .sess-set-row.done', l => l.length), collapsed = await p.$$eval('#sessList .sess-ex.collapsed', l => l.length);
  const partial2 = await snap(p);
  await p.reload(); await p.waitForTimeout(900);
  check(partial2 === await snap(p), `dopo 10 spunte ancora identico (serie fatte ${done}, schede chiuse ${collapsed}, righe aperte fatte ${rowsDone})`);
  check((await p.$$('#sessList .just-done')).length === 0, 'nessun effetto di spunta rimasto appeso');
  // 4. comandi sulle schede NON rifatte: kg, ⋯, tipo di serie, aggiungi serie, riapri una chiusa, togli spunta
  await tag(p);
  await p.click('.sess-set-row.next .check'); await p.waitForTimeout(300);   // rende "vecchie" tutte le altre
  const last = n - 1;
  const stale = await p.evaluate(i => !!document.querySelectorAll('#sessList .sess-ex')[i].__t, last);
  check(stale, 'l\'ultima scheda è una di quelle non rifatte');
  await p.evaluate(i => document.querySelectorAll('#sessList .sess-ex')[i].scrollIntoView({ block: 'center' }), last); await p.waitForTimeout(200);
  const kg = await p.$(`#sessList input[data-ei="${last}"][data-si="0"][data-f="val"]`);
  await kg.fill('77'); await kg.dispatchEvent('change'); await p.waitForTimeout(150);
  check((await sess(p)).exercises[last].sets[0].val === 77, 'campo di una scheda non rifatta: valore salvato');
  await p.click(`#sessList .sess-add-set[data-ei="${last}"]`); await p.waitForTimeout(250);
  check((await sess(p)).exercises[last].sets.length === s1.exercises[last].sets.length + 1, 'Aggiungi serie su una scheda non rifatta');
  await p.click(`#sessList .sess-meta-btn[data-ei="${last - 1}"]`); await p.waitForTimeout(250);
  check(await p.isVisible(`#sessList .sess-mv[data-ei="${last - 1}"][data-d="-1"]`), 'menu ⋯ su una scheda non rifatta');
  await p.click(`#sessList .sess-meta-btn[data-ei="${last - 1}"]`); await p.waitForTimeout(200);
  // riapri una scheda chiusa e togli una spunta
  const col = await p.$('#sessList .sess-ex.collapsed .sess-ex-head');
  if (col) {
    await col.scrollIntoViewIfNeeded(); await col.click({ position: { x: 60, y: 14 } }); await p.waitForTimeout(350);
    const before = (await sess(p)).exercises.flatMap(x => x.sets).filter(s => s.done).length;
    await p.click('#sessList .sess-ex:not(.collapsed) .sess-set-row.done .check >> nth=0'); await p.waitForTimeout(300);
    check((await sess(p)).exercises.flatMap(x => x.sets).filter(s => s.done).length === before - 1, 'scheda chiusa riaperta e spunta tolta');
  } else check(false, 'nessuna scheda chiusa da riaprire');
  // 5. superset: il "giro" in testa al gruppo si aggiorna senza rifare il gruppo
  const gi = (await sess(p)).exercises.findIndex(x => x.linkNext);
  if (gi >= 0) {
    await p.evaluate(i => document.querySelectorAll('#sessList .sess-ex')[i].scrollIntoView({ block: 'center' }), gi); await p.waitForTimeout(200);
    const r0 = await p.textContent('#sessList .sess-grp .g-round');
    await p.click(`#sessList .check[data-ei="${gi}"][data-si="0"]`); await p.waitForTimeout(250);
    await p.click(`#sessList .check[data-ei="${gi + 1}"][data-si="0"]`); await p.waitForTimeout(300);
    await p.click('#tbStop').catch(() => {});
    const r1 = await p.textContent('#sessList .sess-grp .g-round');
    check(r0 !== r1, `superset: giro "${r0}" → "${r1}"`);
  }
  // 6. alla fine: identico a un ridisegno completo
  await p.waitForTimeout(400);
  const p3 = await snap(p); await p.reload(); await p.waitForTimeout(900);
  check(p3 === await snap(p), 'dopo tutti i comandi: identico a un ridisegno completo');
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
