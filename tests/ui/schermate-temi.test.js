// giro delle schermate: modifica scheda, pannello esercizio, timer, calendario e correzione, testo per Claude, tema chiaro, risparmio, 320 px, Android
const { open, tab, full } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const clean = e => e.filter(x => !/Service Worker|installing|404/.test(x));
async function seeded(o) {
  const r = await open(Object.assign({ ls: {} }, o));
  await r.page.evaluate(seedLogs, { weeks: 6, rpe: true });
  await r.page.reload(); await r.page.waitForTimeout(500);
  return r;
}
(async () => {
  let { browser, page, errors } = await seeded({});
  // modifica scheda
  await page.click('#planEditBtn'); await page.waitForTimeout(300);
  await full(page, OUT + '/20-edit.png');
  await page.click('#addExBtn'); await page.waitForTimeout(300);
  await page.click('#planEditBtn'); await page.waitForTimeout(300);
  // pannello esercizio
  await page.click('#exList .ex-sec:not(.closed) .ex-read >> nth=1'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/21-exsheet.png' });
  await page.click('#exSheetTimer'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/22-timerbar.png' });
  await page.click('#timerBar'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/23-timer-sheet.png' });
  await page.click('#timerClose'); await page.click('#tbStop');
  // calendario: dettaglio + correggi
  await tab(page, 'month');
  const cell = await page.$('.cal-cell.trained'); await cell.click(); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#calDayInfo').scrollIntoView());
  await page.screenshot({ path: OUT + '/24-cal-detail.png' });
  await page.click('.det-sets .st >> nth=3'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/25-settype.png' });
  await page.click('#stCancel'); await page.waitForTimeout(200);
  await page.click('.det-edit'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/26-edit-session.png' });
  await page.click('#esCancel');
  // AI
  await page.click('#aiSummaryBtn'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/27-ai.png' });
  const ai = await page.inputValue('#aiText'); check(ai.length > 1000 && /^Ciao Claude/.test(ai), 'testo per Claude pronto: ' + ai.length + ' caratteri');
  await page.click('#aiSheetClose');
  check(!clean(errors).length, 'tema scuro nessun errore ' + clean(errors).join('|'));
  // tema chiaro
  await page.click('#settingsBtn'); await page.waitForTimeout(300);
  await page.click('label.switch:has(#darkToggle)'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/30-light-settings.png' });
  await page.click('#settingsClose'); await page.waitForTimeout(300);
  for (const t of ['workout', 'stats', 'month', 'plan']) { await tab(page, t); await full(page, OUT + `/31-light-${t}.png`); }
  // risparmio energetico
  await page.click('#settingsBtn'); await page.waitForTimeout(300);
  await page.click('label.switch:has(#ecoToggle)'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/32-eco-settings.png' });
  await page.click('#settingsClose'); await tab(page, 'workout'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/33-eco-workout.png' });
  check(!clean(errors).length, 'tema chiaro e risparmio nessun errore ' + clean(errors).join('|'));
  await browser.close();
  // 320 px
  ({ browser, page, errors } = await seeded({ w: 320, h: 640 }));
  for (const t of ['workout', 'stats', 'month', 'plan']) { await tab(page, t); await full(page, OUT + `/40-w320-${t}.png`); }
  const ov = await page.evaluate(() => { const out = []; document.querySelectorAll('main *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1) && getComputedStyle(el).position !== 'fixed') out.push(el.tagName + '.' + el.className + ' ' + Math.round(r.right)); }); return out.slice(0, 15); });
  check(!ov.length, '320 px: niente esce dallo schermo ' + JSON.stringify(ov).slice(0, 200));
  await tab(page, 'workout'); await page.click('#startSessionBtn'); await page.waitForTimeout(500);
  await full(page, OUT + '/41-w320-session.png');
  check(!clean(errors).length, '320 nessun errore ' + clean(errors).join('|'));
  await browser.close();
  // Android
  ({ browser, page, errors } = await seeded({ android: true }));
  await page.click('#settingsBtn'); await page.waitForTimeout(300);
  await full(page, OUT + '/50-android-settings.png');
  check(!clean(errors).length, 'android nessun errore ' + clean(errors).join('|'));
  await browser.close();
})();
