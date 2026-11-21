// backup su Telegram: collega dall'app, primo invio, errori, invio programmato, file reimportabile, scollega
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2], BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const ctl = async q => (await fetch(BASE + '/__ctl?' + q)).text();
const log = async () => JSON.parse(await ctl('tglog=1'));
const status = p => p.evaluate(() => { const s = document.getElementById('tgStatus'); return s.hidden ? '' : s.textContent; });
const GOOD = '123456789:' + 'A'.repeat(31) + 'GOOD', BAD = '123456789:' + 'B'.repeat(35);
(async () => {
  await ctl('reset=1'); await ctl('tgclear=1');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  check(await p.isHidden('#tgCard'), 'senza sincronizzazione il riquadro Telegram non c\'è');
  await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  await p.waitForTimeout(500);
  check(await p.isVisible('#tgCard') && await p.isVisible('#tgOnBtn'), 'con la sincronizzazione: riquadro e Collega');
  await p.evaluate(() => document.getElementById('tgCard').scrollIntoView({ block: 'start' }));
  await p.locator('#tgCard').screenshot({ path: OUT + '/t1-spento.png' });
  // token sbagliato nel formato
  await p.fill('#tgToken', 'ciao'); await p.click('#tgOnBtn'); await p.waitForTimeout(200);
  check(/BotFather/.test(await status(p)), 'token malformato: ' + await status(p));
  // token rifiutato da Telegram
  await p.fill('#tgToken', BAD); await p.click('#tgOnBtn'); await p.waitForTimeout(800);
  check(/non valido/.test(await status(p)), 'token rifiutato: ' + await status(p));
  // nessun messaggio al bot
  await ctl('tgnoupd=1');
  await p.fill('#tgToken', GOOD); await p.click('#tgOnBtn'); await p.waitForTimeout(800);
  check(/scrivigli un messaggio/.test(await status(p)) && /palestra_test_bot/.test(await status(p)), 'bot senza messaggi: ' + await status(p));
  await ctl('tgnoupd=0'); await ctl('tgclear=1');
  // collega
  await p.click('#tgOnBtn'); await p.waitForTimeout(1000);
  const st = await p.textContent('#tgState');
  check(await p.isVisible('#tgOn') && /Fede/.test(st) && /palestra_test_bot/.test(st) && /Prossimo backup/.test(st), 'collegato: ' + st.replace(/\s+/g, ' '));
  check(await p.evaluate(() => document.getElementById('tgToken').value) === '', 'campo token svuotato');
  let calls = await log(), doc = calls.find(c => c.method === 'sendDocument');
  check(!!doc && doc.body.chat_id === '4242' && /^palestra-backup-\d{4}-\d{2}-\d{2}\.json$/.test(doc.body.document.name), 'primo backup inviato subito: ' + (doc && doc.body.document.name));
  console.log('didascalia:', doc.body.caption.replace(/\n/g, ' | '));
  const file = JSON.parse(doc.body.document.text);
  check(file.type === 'palestra-backup' && Object.keys(file.days).length >= 3 && Object.values(file.logs).flat().length > 3, 'file: backup completo (' + Object.values(file.logs).flat().length + ' allenamenti)');
  await p.locator('#tgCard').screenshot({ path: OUT + '/t2-collegato.png' });
  // il server non restituisce mai il token
  const g = await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=tg`)).text();
  check(!g.includes('GOOD') && /"active":true/.test(g), 'GET op=tg senza token: ' + g.slice(0, 120));
  // Invia ora: subito dopo è limitato
  await p.click('#tgSendBtn'); await p.waitForTimeout(600);
  check(/fra un minuto/.test(await status(p)), 'Invia ora subito dopo: ' + await status(p));
  // invio programmato (come il 1° e il 16)
  await ctl('tgclear=1'); await ctl('tgrun=1');
  calls = await log();
  check(calls.filter(c => c.method === 'sendDocument').length === 1, 'funzione programmata: 1 backup inviato');
  // errore programmato: annotato
  await ctl('tgfail=sendDocument'); await ctl('tgrun=1'); await ctl('tgfail=');
  await p.click('#settingsClose'); await p.waitForTimeout(200); await p.click('#settingsBtn'); await p.waitForTimeout(900);
  check(/non riuscito: Chat non trovata/.test(await p.textContent('#tgState')), 'invio fallito annotato: ' + (await p.textContent('#tgState')).replace(/\s+/g, ' '));
  // il file si reimporta nell'app
  const B = await open({ ls: {}, browser: A.browser }), q = B.page;
  await q.click('#settingsBtn'); await q.waitForTimeout(200);
  const [chooser] = await Promise.all([q.waitForEvent('filechooser'), q.click('#importBtn').catch(() => q.click('text=Importa'))]);
  await chooser.setFiles({ name: doc.body.document.name, mimeType: 'application/json', buffer: Buffer.from(doc.body.document.text) });
  await q.waitForTimeout(600);
  const t = await q.evaluate(() => document.getElementById('toastMsg').textContent);
  check(/Importato/.test(t), 'reimportato in un\'altra app: ' + t);
  // scollega
  await p.click('#tgOffBtn'); await p.waitForTimeout(200); await p.click('#confirmYes'); await p.waitForTimeout(800);
  const g2 = await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=tg`)).json();
  check(await p.isVisible('#tgOnBtn') && g2.active === false, 'scollegato: token cancellato dal server');
  await ctl('tgclear=1'); await ctl('tgrun=1');
  check((await log()).length === 0, 'dopo Scollega la funzione programmata non manda niente');
  console.log('errori', JSON.stringify(A.errors.concat(B.errors).filter(x => !/Service Worker|404|status of (4|5)\d\d/.test(x))));
  await A.browser.close();
})();
