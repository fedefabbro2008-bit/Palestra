// esercizi con «(per lato)» nel nome: interruttore in scheda e nel menu dell'allenamento senza errori
const { chromium } = require('playwright');
const { open } = require('./lib');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {}, w: 360, h: 760 });
  const p = A.page;
  await p.click('#dayPills .day-pill >> nth=2'); await p.waitForTimeout(200);   // Venerdì: esercizi "(per lato)" nel nome
  await p.click('#planEditBtn'); await p.waitForTimeout(200);
  const i = await p.evaluate(() => [...document.querySelectorAll('#exList .ex-item-row input[data-f="name"]')].findIndex(e => /Abduzioni/.test(e.value)));
  await p.evaluate(i => document.querySelector(`.ex-side-btn[data-i="${i}"]`).closest('.ex-item-row').scrollIntoView({ block: 'center' }), i);
  await p.waitForTimeout(200); await p.screenshot({ path: OUT + '/110-edit-side.png' });
  await p.click('#planEditBtn'); await p.waitForTimeout(200);
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  const ei = await p.evaluate(() => [...document.querySelectorAll('#sessList .sess-name-input')].findIndex(e => /Abduzioni/.test(e.value)));
  await p.click(`.sess-meta-btn[data-ei="${ei}"]`); await p.waitForTimeout(200);
  await p.evaluate(ei => document.querySelector(`.sess-side-btn[data-ei="${ei}"]`).closest('.sess-ex').scrollIntoView({ block: 'center' }), ei);
  await p.waitForTimeout(250); await p.screenshot({ path: OUT + '/111-sess-side.png' });
  check(!!(await p.$(`.sess-side-btn[data-ei="${ei}"]`)), 'menu ⋯ dell\'esercizio con «(per lato)» nel nome: pulsante presente');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
