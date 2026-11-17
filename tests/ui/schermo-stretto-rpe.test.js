// schermo da 320 px con RPE: i nomi lunghi degli esercizi non vengono tagliati, Termina e Progressi senza errori
const { chromium } = require('playwright');
const { open, full } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {}, w: 320, h: 640 });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 4, rpe: true });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.showRpe = true; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(400);
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  for (let i = 0; i < 9; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(30); }
  await p.click('#tbStop').catch(()=>{});
  await p.evaluate(() => document.querySelector('.sess-ex.current').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/80-w320-rpe.png' });
  // nomi lunghi: altezza giusta del campo (niente testo tagliato)
  const cut = await p.$$eval('#sessList .sess-name-input', els => els.filter(e => e.scrollHeight > e.clientHeight + 1).map(e => e.value.slice(0, 30)));
  check(!cut.length, '320 px: nessun nome tagliato ' + JSON.stringify(cut));
  await p.click('#sessFinishBtn'); await p.waitForTimeout(300);
  if (await p.isVisible('#confirmOverlay.show')) { await p.screenshot({ path: OUT + '/81-w320-confirm.png' }); await p.click('#confirmYes'); }
  await p.waitForTimeout(400);
  await p.click('nav.bottom button[data-tab="plan"]'); await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('restCard').scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/82-w320-rest.png' });
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
