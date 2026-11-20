// allenamento: consiglio con Applica, menu dell'esercizio, drop set, avvicinamento, sostituisci, recupero che finisce, aggiungi esercizio e termina
const { chromium } = require('playwright');
const { open, full } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 5 });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.showRpe = true; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(400);
  // --- allenamento --- sempre su Lunedì (A: primo esercizio di lavoro con i kg); quella che tocca cambia col giorno della prova
  await p.click('#dayPills .day-pill[data-k="A"]'); await p.waitForTimeout(300);
  await p.click('#startSessionBtn'); await p.waitForTimeout(400);
  // chiude il riscaldamento: spunta le prime serie finché l'esercizio corrente non è di lavoro
  for (let i = 0; i < 12; i++) { const k = await p.textContent('.sess-ex.current .sess-name-input').catch(() => ''); const warmEx = await p.$('.sess-ex.current .sess-set-row.warm.next'); const onlyWarm = await p.$$eval('.sess-ex.current .sess-set-row', r => r.every(x => x.classList.contains('warm'))); if (!onlyWarm) break; await p.click('.sess-set-row.next .check'); await p.waitForTimeout(40); }
  await p.click('#tbStop').catch(() => {});
  await p.screenshot({ path: OUT + '/71-session-current.png' });
  const hint = await p.$('.sess-ex.current .hint-chip'); check(!!hint, 'consiglio sull\'esercizio corrente: ' + (hint ? (await hint.textContent()).slice(0, 90) : 'nessuno'));
  const apply = await p.$('.sess-ex.current .hint-apply'); check(!!apply, 'il consiglio ha «Applica»'); if (apply) { await apply.click(); await p.waitForTimeout(200); check(/applicato/.test(await p.textContent('#toastMsg')), 'Applica: ' + await p.textContent('#toastMsg')); }
  // opzioni (muscolo, tipo, recupero)
  await p.click('.sess-ex.current .sess-meta-btn'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/72-session-meta.png' });
  const sel = await p.$eval('.sess-ex.current .sess-secondary-select', s => ({ w: s.clientWidth, sw: s.scrollWidth, t: s.options[s.selectedIndex].text }));
  check(sel.sw <= sel.w + 1, 'menu del muscolo secondario: il testo ci sta (' + sel.t + ')');
  // tipo di serie: drop set sulla 3a serie di lavoro
  const idx = await p.$$('.sess-ex.current .sess-set-row:not(.warm) .idx');
  await idx[idx.length - 1].click(); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/73-settype-live.png' });
  await p.click('.st-opt[data-k="d"]'); await p.waitForTimeout(200);
  check(/Drop set/.test(await p.textContent('#toastMsg')), 'tipo di serie: drop set');
  // avvicinamento
  const wu = await p.$('.sess-ex.current .sess-wu-btn'); if (wu) { await wu.click(); await p.waitForTimeout(200); check(/Avvicinamento/.test(await p.textContent('#toastMsg')), 'avvicinamento: ' + await p.textContent('#toastMsg')); }
  // sostituisci
  await p.click('.sess-ex.current .sess-sub-btn'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/74-substitute.png' });
  const opts = await p.$$eval('#subList .sub-opt .so-name', x => x.map(e => e.textContent).slice(0, 6)); check(opts.length >= 3, 'Sostituisci: alternative proposte (' + opts.slice(0, 3).join(', ') + ')');
  await p.click('#subList .sub-opt >> nth=0'); await p.waitForTimeout(300);
  check(/Sostituito/.test(await p.textContent('#toastMsg')), 'sostituito: ' + await p.textContent('#toastMsg'));
  // spunta con recupero e attesa della fine (recupero accorciato a 3 s)
  await p.click('.sess-ex.current .sess-meta-btn').catch(() => {}); await p.waitForTimeout(100);
  const ri = await p.$('.sess-ex.current .sess-rest-input'); if (ri) { await ri.fill('3'); await ri.dispatchEvent('change'); }
  await p.click('.sess-set-row.next .check'); await p.waitForTimeout(300);
  check(await p.isVisible('#timerBar.show'), 'spunta: parte il recupero (' + await p.textContent('#tbTime') + ')');
  await p.waitForTimeout(3600);
  check(/Recupero terminato/.test(await p.textContent('#toastMsg')), 'recupero finito: avviso');
  // ETA
  await p.click('#sessEta'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/75-eta.png' });
  // aggiungi esercizio e termina
  await p.click('#sessAddExBtn'); await p.waitForTimeout(300); await p.click('#subList .sub-opt >> nth=0'); await p.waitForTimeout(300);
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300);

  if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(500); }
  await p.screenshot({ path: OUT + '/76-done.png' });
  check(await p.evaluate(() => !localStorage.getItem('palestra:session')) && /completato/.test(await p.textContent('#doneCard')), 'Termina: allenamento salvato, riepilogo a schermo');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
