// app completa senza rete: apertura subito dalla copia anche con rete lentissima, versione nuova scaricata in
// sottofondo con «Aggiorna» (mai in allenamento), allenamento intero senza rete con backup, sincronizzazione al
// ritorno della rete; con rete appesa la sincronizzazione non resta bloccata e riprova da sola
const { chromium } = require('playwright');
const { open, tab, BASE } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const ctl = q => fetch(BASE + '__ctl?' + q).then(r => r.text());
const nLogs = p => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs') || '{}')).flat().length);
const toastNew = p => p.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') && /Nuova versione/.test(t.textContent); });
const hasVersion = (p, v) => p.evaluate(v => document.documentElement.innerHTML.includes('versione ' + v), v);
async function serverLogs(code) { const r = await (await fetch(BASE + 'api/sync?code=' + encodeURIComponent(code))).json(); return Object.values((r.data || r).logs || {}).flat().length; }
async function workout(p, sets) {
  await tab(p, 'workout');
  await p.click('#startSessionBtn'); await p.waitForTimeout(500);
  for (let i = 0; i < sets; i++) { const b = await p.$('.sess-set-row.next .check'); if (!b) break; await b.click(); await p.waitForTimeout(120); }
  await p.click('#tbStop').catch(() => {});
  await p.click('#sessFinishBtn'); await p.waitForTimeout(500);
  if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(500); }
}
async function newPage(ctx, errs) {
  const q = await ctx.newPage();
  q.on('pageerror', e => errs.push('pageerror: ' + e.message));
  q.on('console', m => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
  return q;
}
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {}, sw: true, wait: 1500 });
  let p = A.page; const errs = A.errors;
  await p.evaluate(seedLogs, { weeks: 4 });
  await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.reload(); await p.waitForTimeout(600);
  check(await p.evaluate(() => !!navigator.serviceWorker.controller), 'service worker attivo');

  // 1. rete lentissima (il server non risponde): l'app si apre subito dalla copia
  await ctl('hang=1');
  let t0 = Date.now();
  const q1 = await newPage(A.ctx, errs);
  await q1.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => errs.push('apertura: ' + e.message));
  const dt = Date.now() - t0;
  await q1.waitForTimeout(400);
  const pills = await q1.$$eval('#dayPills .day-pill', l => l.length).catch(() => 0);
  check(dt < 1500 && pills >= 3, `rete lentissima: aperta in ${dt} ms (prima aspettava 3 s), ${pills} giornate`);
  await ctl('hang=0'); await q1.close();

  // 2. stessa versione: nessun avviso
  await p.reload(); await p.waitForTimeout(2000);
  check(!(await toastNew(p)), 'versione uguale: nessun avviso');

  // 3. versione nuova pubblicata: si apre la copia, arriva l'avviso, «Aggiorna» carica la nuova
  await ctl('version=v2');
  await p.reload(); await p.waitForTimeout(300);
  check(!(await hasVersion(p, 'v2')), 'versione nuova pubblicata: si apre subito quella salvata');
  let seen = false; for (let i = 0; i < 30 && !seen; i++) { await p.waitForTimeout(100); seen = await toastNew(p); }
  check(seen, 'avviso «Nuova versione dell\'app pronta · Aggiorna»');
  await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.click('#toastAct')]); await p.waitForTimeout(1500);
  check(await hasVersion(p, 'v2'), 'Aggiorna: caricata la versione nuova');
  check(!(await toastNew(p)), 'dopo l\'aggiornamento nessun nuovo avviso');
  // e senza toccare Aggiorna arriva alla prossima apertura
  await ctl('version=v3');
  await p.reload(); await p.waitForTimeout(2000);
  await p.reload(); await p.waitForTimeout(500);
  check(await hasVersion(p, 'v3'), 'senza Aggiorna: versione nuova alla prossima apertura');

  // 4. in allenamento nessun avviso (la versione nuova arriva alla prossima apertura)
  await p.click('#startSessionBtn'); await p.waitForTimeout(400);
  await ctl('version=v4');
  await p.reload(); await p.waitForTimeout(2500);
  check(await p.evaluate(() => !!localStorage.getItem('palestra:session')) && !(await toastNew(p)), 'allenamento in corso: nessun avviso');
  await p.click('#sessFinishBtn').catch(() => {}); await p.waitForTimeout(400);
  if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(400); }
  await ctl('version=');

  // 5. sincronizzazione accesa, poi senza rete: apertura a freddo, allenamento intero, backup
  await tab(p, 'workout');
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:sync')).code);
  const before = await serverLogs(code);
  check(before === await nLogs(p), `sincronizzato: ${before} allenamenti sul server`);
  await A.ctx.setOffline(true);
  await p.close();
  t0 = Date.now();
  p = await newPage(A.ctx, errs);
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  check(Date.now() - t0 < 2500 && /Palestra/.test(await p.title()), `senza rete: aperta a freddo in ${Date.now() - t0} ms`);
  for (const t of ['stats', 'month', 'plan']) { await tab(p, t); await p.waitForTimeout(300); }
  check((await p.textContent('#tab-plan')).length > 200, 'senza rete: statistiche, mese e scheda');
  const n0 = await nLogs(p);
  await workout(p, 5);
  check(await nLogs(p) === n0 + 1, 'senza rete: allenamento fatto e salvato');
  check(/Senza rete/.test(await p.textContent('#syncStatus')), 'senza rete: «' + (await p.textContent('#syncStatus')).trim() + '»');
  await p.click('#settingsBtn'); await p.waitForTimeout(300);
  const dl = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#exportAllBtn')]).then(([d]) => d.path()).then(f => JSON.parse(require('fs').readFileSync(f, 'utf8'))).catch(() => null);
  check(dl && Object.values(dl.logs).flat().length === n0 + 1, 'senza rete: Backup completo con l\'allenamento nuovo');
  // torna la rete: sincronizza da sola
  await A.ctx.setOffline(false);
  let after = 0; for (let i = 0; i < 40 && after !== n0 + 1; i++) { await p.waitForTimeout(250); after = await serverLogs(code); }
  check(after === n0 + 1, `tornata la rete: allenamento arrivato sul server (${after})`);

  // 6. rete appesa durante la sincronizzazione: non resta bloccata («Sincronizzo…» per sempre) e riprova da sola
  await ctl('hang=1');
  await p.keyboard.press('Escape').catch(() => {});
  await p.goto(BASE, { waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(500);   // dalla copia, subito
  await workout(p, 3);   // a Termina parte la sincronizzazione, che resta senza risposta
  let st = ''; for (let i = 0; i < 60 && !/Senza rete/.test(st); i++) { await p.waitForTimeout(500); st = await p.textContent('#syncStatus'); }
  check(/Senza rete/.test(st), 'rete appesa: dopo 20 s smette di aspettare («' + st.trim() + '»)');
  await ctl('hang=0');
  let back = 0; for (let i = 0; i < 90 && back !== n0 + 2; i++) { await p.waitForTimeout(500); back = await serverLogs(code); }
  check(back === n0 + 2, 'rete tornata senza nessun avviso del telefono: riprova da sola e sincronizza');

  const bad = errs.filter(e => !/ERR_INTERNET_DISCONNECTED|net::|404|Failed to fetch|Service Worker registration blocked/.test(e));
  check(!bad.length, 'nessun errore ' + bad.join(' | '));
  await browser.close();
})().catch(async e => { console.log('FAIL ' + e.message); await ctl('hang=0').catch(() => {}); process.exit(1); });
