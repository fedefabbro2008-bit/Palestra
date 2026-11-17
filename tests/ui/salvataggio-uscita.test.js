// uscendo dall'app (pagehide) si riscrive solo quello che non è ancora salvato: niente di inutile, niente sovrascritto
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  await A.page.evaluate(seedLogs, { weeks: 2 });
  // lo storico letto si riconfronta (e si riscrive se serve) subito dopo l'apertura, non prima del primo disegno:
  // qui si esce quando tutto è già salvato
  await A.page.reload(); await A.page.waitForTimeout(2500);
  const r = await A.page.evaluate(() => {
    const out = {};
    ['days','logs','settings'].forEach(k=> out[k] = localStorage.getItem('palestra:'+k));
    localStorage.setItem('palestra:days', '{"X":1}'); localStorage.setItem('palestra:logs', '{"X":1}'); localStorage.setItem('palestra:settings', '{"X":1}');
    window.dispatchEvent(new Event('pagehide'));
    const after = {}; ['days','logs','settings'].forEach(k=> after[k] = localStorage.getItem('palestra:'+k));
    return { out, after };
  });
  for (const k of ['days','logs','settings']) {
    const a = r.out[k], b = r.after[k];
    check(b === '{"X":1}', k + ': non riscritto uscendo (era già salvato)');
    if (b === '{"X":1}') continue;
    if (a === b) { console.log(k, 'rewritten, identical'); continue; }
    let i = 0; while (a[i] === b[i]) i++;
    console.log(k, 'DIFF at', i, '\n  before:', a.slice(i-80, i+120), '\n  after :', b.slice(i-80, i+120));
  }
  // uscendo subito dopo l'apertura (prima del riconfronto) lo storico letto in formato vecchio si salva lo stesso,
  // compatto e con gli stessi allenamenti: niente va perso
  const B = await open({ browser, ls: {} });
  const n0 = await B.page.evaluate(seedLogs, { weeks: 2 });
  const old = await B.page.evaluate(() => localStorage.getItem('palestra:logs'));
  await B.page.reload(); await B.page.waitForTimeout(150);
  const early = await B.page.evaluate(() => { const before = localStorage.getItem('palestra:logs'); window.dispatchEvent(new Event('pagehide')); return { before, after: localStorage.getItem('palestra:logs') }; });
  const nAfter = Object.values(JSON.parse(early.after)).flat().length;
  check(early.before === old && early.after !== old && !/"note":""/.test(early.after) && nAfter === n0, `uscita subito dopo l'apertura: storico salvato compatto (${old.length} → ${early.after.length} caratteri, ${nAfter}/${n0} allenamenti)`);
  await B.page.reload(); await B.page.waitForTimeout(2500);
  check(await B.page.evaluate(() => localStorage.getItem('palestra:logs')) === early.after, 'e alla riapertura resta identico (era già quello giusto)');
  await browser.close();
})();
