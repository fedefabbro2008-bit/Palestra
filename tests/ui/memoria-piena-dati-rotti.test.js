// memoria piena (avvisa, non chiude l'allenamento, salva quando si libera) e dati rotti all'avvio (copia tenuta, app usabile)
const { chromium } = require('playwright');
const { open, BASE } = require('./lib');
const { seedLogs } = require('./seed');
const count = p => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs') || '{}')).flat().length);
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  // --- memoria piena ---
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 2 }); await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (window.__full && /palestra:(logs|session|days|settings)$/.test(k)) throw new DOMException('pieno', 'QuotaExceededError'); return o.call(this, k, v); }; });
  const n0 = await count(p);
  await p.click('#startSessionBtn'); await p.waitForTimeout(200);
  await p.evaluate(() => window.__full = true);
  await p.click('.sess-set-row.next .check'); await p.waitForTimeout(200);
  check(/Spazio esaurito/.test(await p.textContent('#toastMsg')), 'memoria piena durante l\'allenamento: avviso');
  for (let i = 0; i < 3; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(30); }
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300); if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes'); await p.waitForTimeout(300);
  check(await p.isVisible('#sessionView') && /NON salvato/.test(await p.textContent('#toastMsg')) && await count(p) === n0, 'Termina con memoria piena: allenamento resta aperto, niente perso');
  await p.evaluate(() => window.__full = false);
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300); if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes'); await p.waitForTimeout(400);
  check(await count(p) === n0 + 1 && !(await p.isVisible('#sessionView')), 'memoria liberata: Termina salva');
  const er = A.errors.filter(e => !/Service Worker|404|save error/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await A.ctx.close();
  // --- dati corrotti all'avvio ---
  for (const [what, ls] of [
    ['storico illeggibile', { 'palestra:logs': '{"2026-10-01":[{"id":"a","entries":[{"name":"x"', 'palestra:settings': '{"contentVersion":9,"schemaVersion":2}' }],
    ['scheda illeggibile', { 'palestra:days': '[[[', 'palestra:settings': '{"contentVersion":9,"schemaVersion":2}' }],
    ['impostazioni illeggibili', { 'palestra:settings': 'nonjson' }],
    ['tipi sbagliati', { 'palestra:days': '{"A":7,"B":{"name":5,"exercises":"x"}}', 'palestra:logs': '[1,2,3]', 'palestra:settings': '{"dark":"x","bg":5,"planStarts":"oggi","lastDay":{"a":1},"contentVersion":9,"schemaVersion":2}', 'palestra:session': '{"exercises":"x"}', 'palestra:timer': '{"running":true,"endAt":"x","duration":"y"}', 'palestra:sync': '[1]' }],
  ]) {
    const C = await open({ browser, ls });
    const q = C.page;
    const ok = await q.isVisible('#startSessionBtn');
    const toast = await q.textContent('#toastMsg');
    const keep = await q.evaluate(() => Object.keys(localStorage).filter(k => /unreadable|backup/.test(k)));
    // si può ancora allenarsi e salvare
    await q.click('#startSessionBtn'); await q.waitForTimeout(200);
    if (!(await q.$('.sess-set-row.next .check'))) { console.log('  (giornata vuota: aggiungo un esercizio)'); await q.click('#sessAddExBtn'); await q.waitForTimeout(300); await q.click('#subList .sub-opt >> nth=0'); await q.waitForTimeout(300); }
    for (let i = 0; i < 3; i++) { if (!(await q.$('.sess-set-row.next .check'))) break; await q.click('.sess-set-row.next .check'); await q.waitForTimeout(30); }
    await q.click('#sessFinishBtn'); await q.waitForTimeout(300); if (await q.isVisible('#confirmOverlay.show')) await q.click('#confirmYes'); await q.waitForTimeout(300);
    const er = C.errors.filter(e => !/Service Worker|404|load error|save error/.test(e));
    const wantCopy = what === 'storico illeggibile' ? 'palestra:logs-unreadable' : what === 'scheda illeggibile' ? 'palestra:days-unreadable' : null;
    check(ok && await count(q) > 0 && !er.length && (!wantCopy || keep.includes(wantCopy)), `${what}: app usabile, allenamento salvato${wantCopy ? ', copia tenuta (' + wantCopy + ')' : ''}`);
    await C.ctx.close();
  }
  await browser.close();
})();
