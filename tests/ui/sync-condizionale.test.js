// sincronizzazione condizionale: nessun cambiamento -> risposta di pochi byte; cambiamenti qui o altrove -> tutto, come prima
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
function watch(p) {
  const log = [];
  p.on('response', async r => { const u = r.url(); if (!u.includes('/api/sync') || u.includes('op=')) return; let n = 0; try { n = (await r.body()).length; } catch (e) {} log.push({ m: r.request().method(), cond: u.includes('etag='), s: r.status(), n }); });
  return log;
}
const fmt = l => l.map(x => `${x.m}${x.cond ? '(etag)' : ''} ${x.s} ${x.n}B`).join(', ');
(async () => {
  await fetch('http://localhost:8888/__ctl?reset=1');
  const A = await open({ ls: {} }), p = A.page;
  const log = watch(p);
  await p.evaluate(seedLogs, { weeks: 10 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  console.log('attivazione:', fmt(log.splice(0)));
  // riaperture senza cambiamenti
  for (let i = 0; i < 3; i++) { await p.reload(); await p.waitForTimeout(2000); }
  const re = log.splice(0);
  console.log('3 riaperture:', fmt(re));
  check(re.length === 3 && re.every(x => x.cond && x.n < 80), 'riaperture senza cambiamenti: risposta di pochi byte');
  // un cambiamento qui (allenamento finito)
  await p.click('#settingsClose').catch(() => {});
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  for (let i = 0; i < 2; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(100); }
  await p.click('#sessFinishBtn'); await p.waitForTimeout(400); if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes');
  await p.waitForTimeout(4000);
  const ch = log.splice(0);
  console.log('dopo un allenamento:', fmt(ch));
  check(ch.some(x => x.m === 'POST' && x.s === 200) && ch.every(x => x.n < 200), 'cambiamento qui: inviato senza riscaricare lo storico');
  // un altro dispositivo cambia: qui si riceve tutto
  const B = await open({ ls: {}, browser: A.browser }), q = B.page;
  await q.click('#settingsBtn'); await q.click('#syncJoinBtn'); await q.fill('#syncCodeIn', code); await q.click('#syncJoinGo'); await q.waitForTimeout(2000);
  await q.click('#settingsClose'); await q.click('#startSessionBtn'); await q.waitForTimeout(300);
  await q.click('.sess-set-row.next .check'); await q.click('#sessFinishBtn'); await q.waitForTimeout(400); if (await q.isVisible('#confirmOverlay.show')) await q.click('#confirmYes');
  await q.waitForTimeout(4000);
  const nA = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  await p.reload(); await p.waitForTimeout(2500);
  const nA2 = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  const ot = log.splice(0);
  console.log('dopo un cambiamento altrove:', fmt(ot));
  check(nA2 === nA + 1 && ot.some(x => x.cond && x.n > 1000), 'cambiamento altrove: ricevuto (' + nA + ' → ' + nA2 + ')');
  await p.reload(); await p.waitForTimeout(2000);
  const again = log.splice(0);
  check(again.length === 1 && again[0].n < 80, 'riapertura successiva: di nuovo pochi byte (' + fmt(again) + ')');
  console.log('errori', JSON.stringify(A.errors.concat(B.errors).filter(x => !/Service Worker|404|409/.test(x))));
  await A.browser.close();
})();
