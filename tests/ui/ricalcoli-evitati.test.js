// Leggerezza dei calcoli: toccare una giornata salva solo «quale giornata» e non deve rifare statistiche, indice degli
// esercizi e durate previste (prima ogni tocco rifaceva tutto, e le statistiche si ridisegnavano da capo); quando invece
// cambiano i dati (allenamento salvato) si rifanno. In allenamento il menu ⋯ di un esercizio (tendine di muscoli e tipo,
// sposta, superset) si crea solo quando lo apri: prima c'era sempre, nascosto, in ogni scheda
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 8 });
  await p.reload(); await p.waitForTimeout(600);
  const conta = () => p.evaluate(() => Object.assign({}, window.__conta, { dati: window.__conta.dati.join(',') }));
  // dopo l'apertura: il controllo dello storico (rimandato di poco) e le statistiche preparate una sezione alla volta.
  // Poi ogni giornata e ogni sezione viste una volta (la durata prevista di ogni giornata si calcola la prima volta che la scegli)
  await p.waitForTimeout(4000);
  const keys = await p.evaluate(() => [...document.querySelectorAll('#dayPills .day-pill[data-k]')].map((b) => b.dataset.k));
  for (const k of keys) { await p.click(`#dayPills .day-pill[data-k="${k}"]`); await p.waitForTimeout(150); }
  for (const t of ['stats', 'month', 'plan', 'workout']) { await tab(p, t); await p.waitForTimeout(150); }
  await p.waitForTimeout(4500);
  const c0 = await conta();
  // tocchi su altre giornate e ritorno: si salva la giornata scelta
  for (let i = 0; i < 4; i++) { await p.click(`#dayPills .day-pill[data-k="${keys[i % keys.length]}"]`); await p.waitForTimeout(150); }
  const lastDay = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:settings')).lastDay);
  for (const t of ['stats', 'month', 'plan', 'workout']) { await tab(p, t); await p.waitForTimeout(150); }
  await p.waitForTimeout(4500);
  const c1 = await conta();
  check(lastDay === keys[3 % keys.length], 'la giornata scelta si salva (' + lastDay + ')');
  check(c1.stats === c0.stats && c1.indice === c0.indice && c1.durata === c0.durata,
    `4 tocchi sulle giornate e giro delle sezioni: niente rifatto (statistiche ${c0.stats}→${c1.stats}, indice ${c0.indice}→${c1.indice}, durate ${c0.durata}→${c1.durata}; salvataggi che cambiano i dati: «${c0.dati}» → «${c1.dati}»)`);
  // in allenamento: nessun menu ⋯ creato finché non lo apri
  await p.click('#startSessionBtn'); await p.waitForTimeout(500);
  const m0 = await p.evaluate(() => ({ menus: document.querySelectorAll('#sessList .sess-ex-sub').length, selects: document.querySelectorAll('#sessList select').length, cards: document.querySelectorAll('#sessList .sess-ex').length }));
  check(m0.cards > 5 && m0.menus === 0 && m0.selects === 0, `inizia: ${m0.cards} esercizi, nessun menu ⋯ creato (menu ${m0.menus}, tendine ${m0.selects})`);
  await p.click('#sessList .sess-ex.current .sess-meta-btn'); await p.waitForTimeout(200);
  const m1 = await p.evaluate(() => { const sub = document.querySelector('#sessList .sess-ex.current .sess-ex-sub'); return { menus: document.querySelectorAll('#sessList .sess-ex-sub').length, vis: !!sub && !!sub.offsetParent, selects: sub ? sub.querySelectorAll('select').length : 0 }; });
  check(m1.menus === 1 && m1.vis && m1.selects === 3, `⋯ aperto: un menu visibile con muscolo, secondario e tipo (${m1.selects} tendine)`);
  await p.click('#sessList .sess-ex.current .sess-meta-btn'); await p.waitForTimeout(200);
  check(await p.evaluate(() => document.querySelectorAll('#sessList .sess-ex-sub').length) === 0, '⋯ richiuso: il menu sparisce');
  // dati cambiati davvero (allenamento salvato): indice e statistiche si rifanno
  await p.click('.sess-set-row.next .check'); await p.waitForTimeout(150);
  await p.click('#tbStop').catch(() => {});
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300);
  if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(300); }
  await tab(p, 'stats'); await p.waitForTimeout(300);
  const c2 = await conta();
  check(c2.indice > c1.indice && c2.stats > c1.stats, `allenamento salvato: indice (${c1.indice}→${c2.indice}) e statistiche (${c1.stats}→${c2.stats}) rifatti`);
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
