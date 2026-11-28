// collegamento nel backup: codice di sincronizzazione nel file (app e Telegram), import su telefono nuovo -> ricollega tutto
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const fs = require('fs');
const OUT = process.argv[2], BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const ctl = async q => (await fetch(BASE + '/__ctl?' + q)).text();
const GOOD = '123456789:' + 'A'.repeat(31) + 'GOOD';
const importFile = async (q, name, text) => {
  if (!(await q.isVisible('#settingsSheet.show'))) { await q.click('#settingsBtn'); await q.waitForTimeout(200); }
  const [chooser] = await Promise.all([q.waitForEvent('filechooser'), q.click('#importBtn').catch(() => q.click('text=Importa'))]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  await q.waitForTimeout(700);
};
(async () => {
  await ctl('reset=1'); await ctl('tgclear=1'); await ctl('tgnoupd=0');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  // senza sincronizzazione: nessun collegamento nel file
  const dl0 = await Promise.all([p.waitForEvent('download'), p.click('#exportAllBtn')]).then(([d]) => d.path()).then(f => JSON.parse(fs.readFileSync(f, 'utf8'))).catch(e => ({ err: String(e) }));
  check(dl0.type === 'palestra-backup' && !('link' in dl0), 'senza sincronizzazione: backup senza collegamento ' + (dl0.err || ''));
  await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  await p.fill('#tgToken', GOOD); await p.click('#tgOnBtn'); await p.waitForTimeout(1000);
  check(await p.isVisible('#tgOn'), 'A: Telegram collegato');
  // backup dall'app
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportAllBtn')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8'), file = JSON.parse(txt);
  check(file.link && file.link.sync === code, 'Backup completo: contiene il codice ' + JSON.stringify(file.link));
  check(!txt.includes('GOOD') && !/token/i.test(JSON.stringify(file.link)), 'nessun token del bot nel file');
  // backup da Telegram
  await ctl('tgclear=1'); await ctl('tgrun=1');
  const doc = JSON.parse(await ctl('tglog=1')).find(c => c.method === 'sendDocument');
  const tfile = JSON.parse(doc.body.document.text);
  check(tfile.link && tfile.link.sync === code && !doc.body.document.text.includes('GOOD'), 'backup su Telegram: contiene il codice, non il token');
  console.log('didascalia:', doc.body.caption.replace(/\n/g, ' | '));
  // telefono nuovo: import -> proposta -> ricollega
  const B = await open({ ls: {}, browser: A.browser }), q = B.page;
  await importFile(q, doc.body.document.name, doc.body.document.text);
  const msg = await q.evaluate(() => document.querySelector('#confirmOverlay.show') ? document.getElementById('confirmMsg').textContent : '');
  check(/collegamento/.test(msg), 'telefono nuovo: propone di ricollegare: ' + msg.slice(0, 90));
  await q.screenshot({ path: OUT + '/k1-proposta.png' });
  await q.click('#confirmYes'); await q.waitForTimeout(2500);
  const bs = await q.evaluate(() => JSON.parse(localStorage.getItem('palestra:sync') || '{}'));
  check(bs.code === code, 'B: sincronizzazione ricollegata con lo stesso codice');
  await q.click('#settingsClose').catch(() => {}); await q.waitForTimeout(200); await q.click('#settingsBtn'); await q.waitForTimeout(1500);
  check(await q.isVisible('#tgOn'), 'B: Telegram risulta collegato: ' + (await q.textContent('#tgState')).replace(/\s+/g, ' ').slice(0, 80));
  const nB = await q.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  const nA = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  check(nA === nB, 'B ha gli stessi allenamenti di A: ' + nB + ' / ' + nA);
  // telefono già collegato: nessuna proposta
  await importFile(p, 'b.json', txt);
  check(!(await p.isVisible('#confirmOverlay.show')), 'telefono già sincronizzato: nessuna proposta');
  // "Non ora": resta scollegato
  const C = await open({ ls: {}, browser: A.browser }), r = C.page;
  await importFile(r, 'b.json', txt); await r.click('#confirmNo'); await r.waitForTimeout(500);
  check(!(await r.evaluate(() => (JSON.parse(localStorage.getItem('palestra:sync') || '{}')).code)), '«Non ora»: resta senza sincronizzazione');
  // codice che non esiste più sul server: messaggio, niente collegamento
  const D = await open({ ls: {}, browser: A.browser }), u = D.page;
  const bad = JSON.parse(txt); bad.link.sync = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ';
  await importFile(u, 'c.json', JSON.stringify(bad)); await u.click('#confirmYes'); await u.waitForTimeout(1200);
  const tm = await u.evaluate(() => document.getElementById('toastMsg').textContent);
  check(!(await u.evaluate(() => (JSON.parse(localStorage.getItem('palestra:sync') || '{}')).code)) && /Nessun dato/.test(tm), 'codice inesistente: non collega (' + tm + ')');
  for (const X of [A, B, C, D]) console.log('errori', JSON.stringify(X.errors.filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
