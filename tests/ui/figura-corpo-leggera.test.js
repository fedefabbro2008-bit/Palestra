// figura del corpo più leggera: niente <title> nei muscoli (36 elementi in meno per figura), stessa forma per tutte le
// giornate; cambiando giornata la figura non si ricrea (stessi elementi), cambiano solo i colori, subito (nessuna
// transizione del colore che lavori a ogni fotogramma); il primo disegno dopo l'apertura arriva lo stesso
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 4 }); await p.reload(); await p.waitForTimeout(600);
  const fig = () => p.evaluate(() => { const ms = [...document.querySelectorAll('#bodyFigs .bd-m')];
    return { n: ms.length, titles: document.querySelectorAll('#bodyFigs title').length, cls: ms.map((e) => e.getAttribute('data-m') + ':' + e.getAttribute('class')).join('|'), d: ms.map((e) => e.getAttribute('d')).join('|') }; });
  const f0 = await fig();
  check(f0.n >= 30 && f0.titles === 0, `figura disegnata dopo l'apertura: ${f0.n} muscoli, ${f0.titles} <title>`);
  await p.evaluate(() => { window.__nodes = [...document.querySelectorAll('#bodyFigs .bd-m')]; });
  const keys = await p.evaluate(() => [...document.querySelectorAll('#dayPills .day-pill[data-k]')].map((b) => b.dataset.k));
  const cur = await p.evaluate(() => document.querySelector('#dayPills .day-pill.active').dataset.k), other = keys.find((k) => k !== cur);
  await p.evaluate((k) => document.querySelector(`#dayPills .day-pill[data-k="${k}"]`).click(), other);
  const run = await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('bd-m')).length))));
  await p.waitForTimeout(300);
  const f1 = await fig();
  const same = await p.evaluate(() => { const now = [...document.querySelectorAll('#bodyFigs .bd-m')]; return now.length === window.__nodes.length && now.every((e, i) => e === window.__nodes[i]); });
  check(same && f1.d === f0.d, 'cambiando giornata la figura resta la stessa (stessi elementi, stessa forma)');
  check(f1.cls !== f0.cls && run === 0, `cambiano solo i colori dei muscoli, subito (transizioni in corso sui muscoli: ${run})`);
  const chips = await p.evaluate(() => [...document.querySelectorAll('#bodyChips .bd-chip')].map((c) => c.dataset.m + ':' + c.className.replace('bd-chip ', '')));
  const lv = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#bodyFigs .bd-m')].map((e) => [e.getAttribute('data-m'), e.getAttribute('class').replace(/bd-m |sel/g, '').trim()])));
  check(chips.length > 0 && chips.every((c) => { const [m, k] = c.split(':'); return lv[m] === k.replace(/\s*sel/, '').trim(); }), 'colori della figura uguali a quelli dei muscoli elencati sotto (' + chips.join(', ') + ')');
  // tocco su un muscolo: si accende lui (la scelta usa ancora le sue transizioni di opacità e forma)
  await p.evaluate(() => document.getElementById('bodyCard').scrollIntoView());
  const m = chips[0].split(':')[0];
  await p.click(`#bodyFigs .bd-m[data-m="${m}"] >> nth=0`); await p.waitForTimeout(500);
  check(await p.evaluate((m) => { const all = document.querySelectorAll(`#bodyFigs .bd-m[data-m="${m}"]`).length, sel = document.querySelectorAll(`#bodyFigs .bd-m.sel[data-m="${m}"]`).length, other = document.querySelectorAll('#bodyFigs .bd-m.sel:not([data-m="' + m + '"])').length; return all > 0 && sel === all && !other && /serie/.test(document.getElementById('bodyDetail').textContent); }, m), `tocco su ${m}: acceso (tutte le sue forme, solo lui), con le sue serie sotto`);
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
