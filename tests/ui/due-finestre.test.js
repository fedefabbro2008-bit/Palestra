// app aperta in due finestre: salvataggi e cancellazioni non si sovrascrivono, un allenamento terminato in una si chiude nell'altra, il tema passa
const { chromium } = require('playwright');
const { open, BASE } = require('./lib');
const { seedLogs } = require('./seed');
const ids = p => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs') || '{}')).flat().map(s => String(s.id)));
const finish = async p => { await p.click('#sessFinishBtn'); await p.waitForTimeout(300); if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes'); await p.waitForTimeout(400); };
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  await A.page.evaluate(seedLogs, { weeks: 2 }); await A.page.reload(); await A.page.waitForTimeout(400);
  const B = await A.ctx.newPage(); const errB = []; B.on('pageerror', e => errB.push(e.message));
  await B.goto(BASE); await B.waitForTimeout(500);
  const before = await ids(A.page);
  // 1) A salva un allenamento, poi B (aperta da prima) elimina un allenamento vecchio
  await A.page.click('#startSessionBtn'); await A.page.waitForTimeout(200);
  for (let i = 0; i < 5; i++) { await A.page.click('.sess-set-row.next .check'); await A.page.waitForTimeout(30); }
  await finish(A.page);
  const newId = (await ids(A.page)).find(x => !before.includes(x));
  await B.waitForTimeout(300);
  await B.click('nav.bottom button[data-tab="month"]'); await B.waitForTimeout(300);
  await B.click('.cal-cell.trained >> nth=0'); await B.waitForTimeout(200);
  await B.click('.det-del'); await B.waitForTimeout(200); await B.click('#confirmYes'); await B.waitForTimeout(600);
  const after = await ids(B);
  check(after.length === before.length && after.includes(newId), `A salva, B (aperta da prima) cancella: ${after.length} allenamenti, quello di A c'è ancora`);
  // 2) stesso allenamento aperto in tutte e due (ripreso in B), terminato in A: B si chiude, niente doppioni
  await B.click('nav.bottom button[data-tab="workout"]'); await B.waitForTimeout(200);
  await A.page.click('#startSessionBtn'); await A.page.waitForTimeout(300);
  await B.reload(); await B.waitForTimeout(500);   // B riapre e trova l'allenamento in corso
  check(await B.isVisible('#sessionView'), 'B riapre e trova l\'allenamento in corso');
  for (let i = 0; i < 3; i++) { await A.page.click('.sess-set-row.next .check'); await A.page.waitForTimeout(30); }
  await finish(A.page); await B.waitForTimeout(400);
  check(!(await B.isVisible('#sessionView')) && /altra finestra/.test(await B.textContent('#toastMsg')), 'Termina in A: B chiude l\'allenamento e lo dice');
  const all = await ids(B); check(all.length === new Set(all).size, 'nessun allenamento doppio');
  // 3) impostazioni: tema cambiato in A arriva in B
  await A.page.click('#settingsBtn'); await A.page.click('label.switch:has(#darkToggle)'); await A.page.waitForTimeout(300);
  check(/light/.test(await B.evaluate(() => document.body.className)), 'il tema cambiato in A arriva in B');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)).concat(errB); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
