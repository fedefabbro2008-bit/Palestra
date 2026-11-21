// sincronizzazione fra due telefoni: collegamento col codice, unione, cancellazione e tema che passano, salvataggi nello stesso istante, server giù
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const clean = e => e.filter(x => !/Service Worker|installing|404/.test(x));
const count = p => p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs') || '{}'); return Object.values(l).reduce((a, x) => a + x.length, 0); });
const status = p => p.evaluate(() => document.getElementById('syncStatus').textContent);
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  await A.page.evaluate(seedLogs, { weeks: 3 });
  await A.page.reload(); await A.page.waitForTimeout(400);
  await A.page.click('#settingsBtn'); await A.page.waitForTimeout(200);
  await A.page.click('#syncNewBtn'); await A.page.waitForTimeout(1500);
  const code = (await A.page.textContent('#syncCodeShow')).trim();
  const nA = await count(A.page); check(/Sincronizzato/.test(await status(A.page)) && nA > 0, 'A: sincronizzazione attiva con ' + nA + ' allenamenti');
  await A.page.screenshot({ path: OUT + '/60-sync-on.png' });
  // B: nuovo dispositivo con un suo allenamento, si collega
  const B = await open({ browser, ls: {} });
  await B.page.evaluate(seedLogs, { weeks: 1 });   // stessi id "seed0.." di A: stesso allenamento? no: dati diversi con stessi id
  await B.page.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); Object.values(l).forEach(a => a.forEach(s => s.id = 'B-' + s.id)); localStorage.setItem('palestra:logs', JSON.stringify(l)); });
  await B.page.reload(); await B.page.waitForTimeout(400);
  const bBefore = await count(B.page);
  await B.page.click('#settingsBtn'); await B.page.click('#syncJoinBtn'); await B.page.fill('#syncCodeIn', code.toLowerCase().replace(/-/g, ' '));
  await B.page.click('#syncJoinGo'); await B.page.waitForTimeout(2000);
  check(await count(B.page) === nA + bBefore && /Sincronizzato/.test(await status(B.page)), 'B col codice (scritto minuscolo e con spazi): riceve gli allenamenti di A (' + await count(B.page) + ')');
  // A si aggiorna
  await A.page.click('#syncNowBtn'); await A.page.waitForTimeout(1500);
  check(await count(A.page) === nA + bBefore, 'A dopo la sincronizzazione: ' + await count(A.page));
  // B cambia il tema (impostazione sincronizzata) e cancella un allenamento
  await B.page.click('label.switch:has(#darkToggle)'); await B.page.waitForTimeout(300);
  await B.page.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); const k = Object.keys(l)[0]; l[k].shift(); if (!l[k].length) delete l[k]; localStorage.setItem('palestra:logs', JSON.stringify(l)); });
  await B.page.reload(); await B.page.waitForTimeout(400);   // ricarica: la cancellazione "a mano" diventa lo stato di B
  await B.page.click('#settingsBtn'); await B.page.click('#syncNowBtn'); await B.page.waitForTimeout(1500);
  const nB = await count(B.page); check(nB === nA + bBefore - 1, 'B: cancellato un allenamento (' + nB + ')');
  await A.page.click('#syncNowBtn'); await A.page.waitForTimeout(1500);
  check(await count(A.page) === nB, 'A riceve la cancellazione (' + await count(A.page) + ')');
  check(/light/.test(await A.page.evaluate(() => document.body.className)), 'A riceve il tema cambiato su B');
  // modifiche contemporanee: tutte e due aggiungono un allenamento e sincronizzano insieme
  const addOne = (p, id) => p.evaluate(id => { const l = JSON.parse(localStorage.getItem('palestra:logs')); const iso = Object.keys(l).sort().pop(); const s = JSON.parse(JSON.stringify(l[iso][0])); s.id = id; s.startedAt += 3600e3; s.endedAt += 3600e3; l[iso].push(s); localStorage.setItem('palestra:logs', JSON.stringify(l)); }, id);
  await addOne(A.page, 'concA'); await addOne(B.page, 'concB');
  await A.page.reload(); await B.page.reload(); await A.page.waitForTimeout(300); await B.page.waitForTimeout(300);
  await A.page.click('#settingsBtn'); await B.page.click('#settingsBtn');
  await fetch('http://localhost:8888/__ctl?delay=400');
  await Promise.all([A.page.click('#syncNowBtn'), B.page.click('#syncNowBtn')]);
  await A.page.waitForTimeout(3000);
  await fetch('http://localhost:8888/__ctl?delay=0');
  const srv = async (tag) => { const d = await (await fetch('http://localhost:8888/__ctl?dump=1')).json(); const e = d[0][1][0][1]; const j = JSON.parse(e.text); console.log('  server', tag, 'rev', j.rev, 'conc:', Object.values(j.logs).flat().map(s=>s.id).filter(i=>/^conc/.test(i)).join(',')); };
  await srv('dopo sync contemporanea');
  console.log('  A status', await status(A.page), '| B status', await status(B.page));
  console.log('  A ids', await (async()=>{ return A.page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().map(s => s.id).filter(i => /^conc/.test(i)).join(',')); })());
  await A.page.click('#syncNowBtn'); await A.page.waitForTimeout(1200); await srv('dopo A'); console.log('  A status', await status(A.page)); await B.page.click('#syncNowBtn'); await B.page.waitForTimeout(1200); await srv('dopo B');
  const ids = p => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().map(s => s.id).filter(i => /^conc/.test(i)).sort().join(','));
  check(await ids(A.page) === 'concA,concB' && await ids(B.page) === 'concA,concB' && await count(A.page) === await count(B.page), 'salvataggi nello stesso istante: tutti e due gli allenamenti su A e su B');
  console.log('status A:', await status(A.page), '| B:', await status(B.page));
  // server giù
  await fetch('http://localhost:8888/__ctl?down=1');
  await A.page.click('#syncNowBtn'); await A.page.waitForTimeout(1200);
  check(/non risponde/.test(await status(A.page)), 'server giù: lo dice (' + await status(A.page) + ')');
  await fetch('http://localhost:8888/__ctl?down=0');
  const ce = clean(A.errors.concat(B.errors)).filter(x => !/409/.test(x)); check(!ce.length, 'nessun errore (il 409 è il conflitto previsto) ' + ce.join('|'));
  await browser.close();
})();
