// esercizi per lato: interruttore in scheda, colonna Rip/lato, peso sollevato doppio, menu ⋯, riepilogo, Correggi che lo toglie
const { chromium } = require('playwright');
const { open, tab } = require('./lib');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  // 1. scheda: interruttore su "Alzate laterali alla macchina" (Lunedì)
  await p.click('#dayPills .day-pill >> nth=0'); await p.waitForTimeout(200);
  const eta0 = await p.textContent('#startSessionBtn');
  await p.click('#planEditBtn'); await p.waitForTimeout(200);
  const idx = await p.evaluate(() => [...document.querySelectorAll('#exList .ex-item-row input[data-f="name"]')].findIndex(e => /Alzate laterali/.test(e.value)));
  await p.click(`.ex-side-btn[data-i="${idx}"]`); await p.waitForTimeout(200);
  const btn = await p.textContent(`.ex-side-btn[data-i="${idx}"]`);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:days')).A.exercises.filter(e => /Alzate laterali|per lato/i.test(e.name)).map(e => e.name.slice(0, 30) + ' perSide=' + e.perSide));
  check(/per lato/i.test(btn) && stored.some(x => /Alzate laterali.*perSide=true/.test(x)), 'scheda: «per lato» acceso e salvato');
  await p.click('#planEditBtn'); await p.waitForTimeout(200);
  const meta = await p.evaluate(() => [...document.querySelectorAll('#exList .ex-read')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).filter(t => /Alzate laterali/.test(t)));
  check(meta.length === 1 && /per lato/.test(meta[0]), 'elenco della scheda: «per lato»');
  // 2. allenamento: colonna Rip/lato, 3 serie da 10 kg × 12
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  const ei = await p.evaluate(() => [...document.querySelectorAll('#sessList .sess-name-input')].findIndex(e => /Alzate laterali/.test(e.value)));
  const head = await p.$eval(`.sess-ex[data-k] .sess-name-input[data-ei="${ei}"]`, el => el.closest('.sess-ex').querySelector('.sess-col-head').textContent);
  check(/Rip\/lato/.test(head), 'allenamento: colonna «Rip/lato»');
  const ton0 = await p.evaluate(() => document.getElementById('sessMeta').textContent);
  for (let si = 0; si < 3; si++) {
    await p.fill(`input[data-ei="${ei}"][data-si="${si}"][data-f="kg"]`, '10');
    await p.fill(`input[data-ei="${ei}"][data-si="${si}"][data-f="val"]`, '12');
    await p.click(`.check[data-ei="${ei}"][data-si="${si}"]`); await p.waitForTimeout(60);
  }
  await p.click('#tbStop').catch(() => {});
  await p.waitForTimeout(900);
  check(/720 kg/.test(await p.evaluate(() => document.getElementById('sessMeta').textContent)), 'peso sollevato contando i due lati: 720 kg (10×12×3×2)');
  // 3. stesso allenamento: tolgo "per lato" a un esercizio che lo ha nel nome? (Lunedì non ne ha: lo provo su Alzate, da ⋯)
  //    l'esercizio finito è chiuso: si riapre toccandolo, poi ⋯ (il menu si crea solo quando lo apri)
  const shut = p.locator('.sess-ex.collapsed', { has: p.locator(`.sess-name-input[data-ei="${ei}"]`) });
  if (await shut.count()) { await shut.locator('.sess-ex-head').click({ position: { x: 20, y: 12 } }); await p.waitForTimeout(200); }
  await p.click(`.sess-meta-btn[data-ei="${ei}"]`);
  await p.waitForTimeout(150);
  const sideBtn = await p.$(`.sess-side-btn[data-ei="${ei}"]`);
  check(!!sideBtn && await sideBtn.isVisible() && /Per lato/.test(await sideBtn.textContent()), 'menu ⋯: pulsante «Per lato» (visibile)');
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300);
  if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes');
  await p.waitForTimeout(400);
  const dc = await p.evaluate(() => [...document.querySelectorAll('.dc-tiles .m-tile')].map(t => t.textContent.replace(/\s+/g, ' ').trim()));
  const entry = await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); const s = Object.values(l).flat().pop(); return s.entries.find(e => /Alzate laterali/.test(e.name)); });
  check(dc.some(t => /720 kg/.test(t)) && entry.perSide === true, 'riepilogo: 720 kg, salvato come per lato');
  // 5. calendario: dettaglio + correggi (tolgo per lato)
  await tab(p, 'month'); await p.waitForTimeout(200);
  await p.click('.cal-cell.today'); await p.waitForTimeout(200);
  const det = await p.evaluate(() => [...document.querySelectorAll('.det-row')].filter(r => /Alzate laterali/.test(r.textContent)).map(r => r.querySelector('.det-meta').textContent));
  check(det.length === 1 && /per lato · 720 kg/.test(det[0]), 'calendario: ' + det.join(''));
  await p.click('.det-edit'); await p.waitForTimeout(300);
  const ci = await p.evaluate(() => [...document.querySelectorAll('#esList .es-ex')].findIndex(x => /Alzate laterali/.test(x.textContent)));
  await p.click(`#esList input[data-f="perSide"][data-ei="${ci}"]`); await p.click('#esSave'); await p.waitForTimeout(300);
  const det2 = await p.evaluate(() => [...document.querySelectorAll('.det-row')].filter(r => /Alzate laterali/.test(r.textContent)).map(r => r.querySelector('.det-meta').textContent));
  const entry2 = await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); const s = Object.values(l).flat().pop(); return s.entries.find(e => /Alzate laterali/.test(e.name)); });
  check(/360 kg/.test(det2.join('')) && !/per lato/.test(det2.join('')) && entry2.perSide === undefined, 'Correggi togliendo «per lato»: 360 kg');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
