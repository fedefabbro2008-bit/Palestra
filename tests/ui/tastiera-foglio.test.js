// tastiera (iPhone) nel foglio «Nuova giornata»: toccando kg o ripetizioni di un esercizio in fondo, il foglio si
// accorcia all'area sopra la tastiera e scorre fino al campo, che resta visibile; anche il nome in alto resta visibile;
// chiusa la tastiera il foglio torna com'era. Prima i campi in basso finivano sotto la tastiera (la correzione per la
// tastiera valeva solo per la pagina, non per le finestre che salgono dal basso)
const { chromium } = require('playwright');
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [320, 640]]) {
    const A = await open({ browser, ls: {}, w, h }), p = A.page;
    await p.evaluate(() => document.getElementById('newMainDayBtn').click()); await p.waitForTimeout(300);
    for (let i = 0; i < 3; i++) { await p.evaluate(() => document.getElementById('ndAddBtn').click()); await p.waitForTimeout(200); await p.evaluate(() => document.querySelector('#subList .sub-opt').click()); await p.waitForTimeout(200); }
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms)), KB = 300, view = innerHeight - KB;
      const ov = document.getElementById('newDaySheet'), sh = ov.querySelector('.sheet');
      const look = (el) => { const e = el.getBoundingClientRect(), s = sh.getBoundingClientRect(); return { top: Math.round(e.top), bottom: Math.round(e.bottom), sheetTop: Math.round(s.top), sheetBottom: Math.round(s.bottom), fit: ov.classList.contains('kb-fit') }; };
      const kbOpen = async (el) => { el.focus({ preventScroll: true }); Object.defineProperty(visualViewport, 'height', { get: () => view, configurable: true }); window.__kbApply(); await wait(60); return look(el); };
      const rows = document.querySelectorAll('#ndList .nd-ex');
      const kg = await kbOpen(rows[rows.length - 1].querySelector('input[data-f="kg"]'));
      const name = await kbOpen(document.getElementById('ndName'));
      document.activeElement.blur(); delete visualViewport.height; window.__kbApply(); await wait(60);
      return { view, kg, name, after: { fit: ov.classList.contains('kb-fit'), h: ov.style.height, top: ov.style.top, sheetBottom: Math.round(sh.getBoundingClientRect().bottom), ih: innerHeight } };
    });
    const tag = `${w}×${h}`;
    check(r.kg.fit && r.kg.top >= 0 && r.kg.bottom <= r.view && r.kg.sheetTop >= 0 && r.kg.sheetBottom <= r.view + 1, `${tag}: kg dell'ultimo esercizio sopra la tastiera (${r.kg.top}-${r.kg.bottom}, tastiera da ${r.view}), foglio dentro l'area visibile (${r.kg.sheetTop}-${r.kg.sheetBottom})`);
    check(r.name.top >= r.name.sheetTop && r.name.bottom <= r.view, `${tag}: anche il nome in alto resta visibile (${r.name.top}-${r.name.bottom})`);
    check(!r.after.fit && !r.after.h && !r.after.top && Math.abs(r.after.sheetBottom - r.after.ih) <= 1, `${tag}: chiusa la tastiera il foglio torna giù come prima`);
    const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
    check(!errs.length, `${tag}: nessun errore ` + errs.join(' | '));
    await A.ctx.close();
  }
  await browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
