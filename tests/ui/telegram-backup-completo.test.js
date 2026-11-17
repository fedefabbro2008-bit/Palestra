// backup su Telegram = backup completo: stesse impostazioni (anche quelle non sincronizzate), stessa scheda, stesso storico
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const ctl = async q => (await fetch(BASE + '/__ctl?' + q)).text();
const GOOD = '123456789:' + 'A'.repeat(31) + 'GOOD';
function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
const strip = o => { const c = Object.assign({}, o); delete c.lastDay; delete c.lastExportAt; return c; };
(async () => {
  await ctl('reset=1'); await ctl('tgclear=1');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 4 });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.fileBackupAfter = false; s.clockMode = 'stopwatch'; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1800);
  await p.fill('#tgToken', GOOD); await p.click('#tgOnBtn'); await p.waitForTimeout(1200);
  const full = await p.evaluate(() => ({ days: JSON.parse(localStorage.getItem('palestra:days')), logs: JSON.parse(localStorage.getItem('palestra:logs')), settings: JSON.parse(localStorage.getItem('palestra:settings')) }));
  let doc = JSON.parse(await ctl('tglog=1')).filter(c => c.method === 'sendDocument').pop();
  let f = JSON.parse(doc.body.document.text);
  check(f.settings.fileBackupAfter === false && f.settings.clockMode === 'stopwatch', 'impostazioni non sincronizzate nel file (fileBackupAfter, clockMode)');
  check(stableStr(strip(f.settings)) === stableStr(strip(full.settings)), 'impostazioni identiche a quelle dell\'app');
  check(stableStr(f.days) === stableStr(full.days) && stableStr(f.logs) === stableStr(full.logs), 'scheda e storico identici');
  // cambio un'impostazione che non si sincronizza: arriva al server e nel backup dopo
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.clockMode = 'timer'; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(3500);
  await ctl('tgclear=1'); await ctl('tgrun=1');
  doc = JSON.parse(await ctl('tglog=1')).filter(c => c.method === 'sendDocument').pop();
  f = JSON.parse(doc.body.document.text);
  check(f.settings.clockMode === 'timer', 'impostazione cambiata dopo: nel backup programmato (' + f.settings.clockMode + ')');
  // la giornata di turno da sola non fa partire invii
  const reqs = [];
  p.on('request', r => { if (r.url().includes('/api/sync') && !r.url().includes('op=') && r.method() === 'POST') reqs.push(1); });
  await p.click('#settingsClose').catch(() => {});
  await p.click('#dayPills .day-pill >> nth=1'); await p.waitForTimeout(3500);
  check(reqs.length === 0, 'toccare un\'altra giornata non manda niente al server');
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404|status of (4|5)\d\d/.test(x))));
  await A.browser.close();
})();
