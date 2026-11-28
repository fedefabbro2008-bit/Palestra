// sicurezza: testi malevoli in scheda, storico, note e impostazioni restano testo in tutte le schermate; CSV senza formule
const { chromium } = require('playwright');
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const { P, poison } = require('./xss');
const check = async (p, where) => {
  const r = await p.evaluate(() => ({ x: window.__xss || [], el: document.querySelectorAll('[data-x]').length }));
  const bad = r.x.length || r.el;
  console.log((bad ? 'FAIL ' : 'OK   ') + where + (bad ? ' codice eseguito! ' + JSON.stringify(r) : ': mostrato come testo'));
};
(async () => {
  const browser = await chromium.launch();
  const Z = await open({ browser, ls: {} });
  await Z.page.evaluate(seedLogs, { weeks: 4, rpe: true });
  await Z.page.evaluate(`(${poison.toString()})(${P.toString()})`);
  const dump = await Z.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  await Z.ctx.close();
  const A = await open({ browser, ls: dump });
  const p = A.page; let dialogs = 0; p.on('dialog', d => { dialogs++; d.dismiss(); });
  await p.waitForTimeout(400);
  const vis = await p.evaluate(() => (document.body.innerText.match(/<img data-x/g) || []).length); console.log((vis > 0 ? 'OK   ' : 'FAIL ') + 'il testo malevolo si vede come testo (' + vis + ' volte)');
  await check(p, 'home');
  await p.click('#planEditBtn'); await p.waitForTimeout(200); await check(p, 'modifica scheda'); await p.click('#planEditBtn');
  await p.click('#moreBtn'); await p.waitForTimeout(200); await check(p, 'altri allenamenti (versioni corte)'); await p.click('#moreBtn'); await p.waitForTimeout(300);
  await p.click('#exList .ex-sec:not(.closed) .ex-read >> nth=0'); await p.waitForTimeout(300); await check(p, 'storico esercizio'); await p.click('#exSheetClose');
  await p.click('#timerBar'); await p.waitForTimeout(200); await check(p, 'timer'); await p.click('#timerClose');
  for (const t of ['stats', 'month', 'plan']) { await tab(p, t); await p.waitForTimeout(300); await check(p, 'sezione ' + t); }
  await tab(p, 'month');
  const nCells = await p.$$eval('.cal-cell.trained', x => x.length);
  for (let i = 0; i < nCells; i++) { await p.click(`.cal-cell.trained >> nth=${i}`); await p.waitForTimeout(80); await check(p, 'giorno ' + i); if (i < nCells - 1) await p.click(`.cal-cell.trained >> nth=${i}`); }
  if (!(await p.$('.det-edit'))) await p.click('.cal-cell.trained >> nth=0');
  await check(p, 'calendario dettaglio');
  await p.click('.det-edit'); await p.waitForTimeout(300); await check(p, 'correggi allenamento'); await p.click('#esCancel');
  await p.click('#aiSummaryBtn'); await p.waitForTimeout(300); await check(p, 'riepilogo Claude'); await p.click('#aiSheetClose');
  await p.selectOption('#progPicker', { index: 1 }); await p.waitForTimeout(200); await check(p, 'progressione');
  await tab(p, 'plan'); await p.click('#exTable .xt-row >> nth=0').catch(()=>{}); await p.waitForTimeout(200);
  const more = await p.$('#restExMore'); if (more) { await more.click(); await p.waitForTimeout(200); }
  await check(p, 'progressi dettagli');
  await tab(p, 'workout');
  await p.click('#startSessionBtn'); await p.waitForTimeout(400); await check(p, 'allenamento');
  await p.click('.sess-ex.current .sess-meta-btn'); await p.click('.sess-ex.current .sess-sub-btn'); await p.waitForTimeout(300); await check(p, 'sostituisci');
  await p.fill('#subSearch', P('custom')); await check(p, 'ricerca con testo malevolo'); await p.click('#subUseBtn'); await p.waitForTimeout(300); await check(p, 'sostituto con nome malevolo');
  for (let i = 0; i < 6; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(40); }
  await p.fill('#sessNotes', P('sessnote'));
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300);
  if (await p.isVisible('#confirmOverlay.show')) { await check(p, 'avvisi prima di salvare'); await p.click('#confirmYes'); }
  await p.waitForTimeout(500); await check(p, 'fine allenamento');
  await p.click('#settingsBtn'); await p.waitForTimeout(300); await check(p, 'impostazioni');
  // CSV: nessuna cella che inizi con = + - @ (formula)
  const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('#backupMoreBtn'); await p.click('#exportCsvBtn'); })()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  const cells = csv.split(/\r\n/).slice(1).flatMap(l => l.split(';'));
  const nf = cells.filter(c => /^"?[=+@]/.test(c) || /^"?-[^\d]/.test(c)).length; console.log((nf === 0 && dialogs === 0 ? 'OK   ' : 'FAIL ') + 'CSV senza celle-formula (' + nf + '), nessuna finestra aperta (' + dialogs + ')');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); console.log((er.length ? 'FAIL ' : 'OK   ') + 'nessun errore ' + er.join('|'));
  await browser.close();
})();
