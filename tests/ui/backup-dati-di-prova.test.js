// backup reale: import, tutte le schermate, allenamento, correzione, Claude (MCP), Telegram, sincronizzazione
const { open, tab, full } = require('./lib');
const fs = require('fs');
const OUT = process.argv[2], FILE = process.argv[3], BASE = 'http://localhost:8888';
const NLOGS = Object.values(JSON.parse(require('fs').readFileSync(FILE, 'utf8')).logs).flat().length;
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  await fetch(BASE + '/__ctl?reset=1'); await fetch(BASE + '/__ctl?tgclear=1');
  const A = await open({ ls: {} }), p = A.page;
  const t0 = Date.now();
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#importBtn')]);
  await ch.setFiles(FILE); await p.waitForTimeout(800);
  if (await p.isVisible('#confirmOverlay.show')) { console.log('conferma import:', (await p.textContent('#confirmMsg')).slice(0, 200)); await p.click('#confirmYes'); await p.waitForTimeout(600); }
  console.log('import:', await p.textContent('#toastMsg'));
  await p.click('#settingsClose'); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(800);
  console.log('home:', (await p.textContent('#todayCard')).replace(/\s+/g, ' ').slice(0, 260));
  await full(p, OUT + '/r1-home.png');
  for (const t of ['stats', 'month', 'plan']) {
    const s = Date.now(); await tab(p, t); await p.waitForTimeout(500);
    console.log(t, 'in', Date.now() - s, 'ms:', (await p.textContent('#tab-' + t)).replace(/\s+/g, ' ').slice(0, 300));
    await full(p, OUT + '/r-' + t + '.png');
  }
  await tab(p, 'workout');
  // allenamento: tocca Venerdì? usa quello proposto
  await p.click('#startSessionBtn'); await p.waitForTimeout(600);
  console.log('allenamento:', await p.textContent('#sessTitle'), '| stima', (await p.textContent('#sessEta').catch(() => '')).replace(/\s+/g, ' ').slice(0, 80));
  const hints = await p.$$eval('.hint-chip', l => l.map(x => x.textContent.replace(/\s+/g, ' ').slice(0, 140)));
  console.log('consigli:', JSON.stringify(hints));
  await p.screenshot({ path: OUT + '/r2-sessione.png' });
  for (let i = 0; i < 4; i++) { const b = await p.$('.sess-set-row.next .check'); if (!b) break; await b.click(); await p.waitForTimeout(80); }
  await p.click('#tbStop').catch(() => {});
  await p.click('#sessFinishBtn'); await p.waitForTimeout(500);
  if (await p.isVisible('#confirmOverlay.show')) { console.log('avvisi:', (await p.textContent('#confirmMsg')).replace(/\s+/g, ' ').slice(0, 300)); await p.click('#confirmYes'); await p.waitForTimeout(500); }
  console.log('fine:', (await p.textContent('#doneCard')).replace(/\s+/g, ' ').slice(0, 200));
  // testo per Claude
  await tab(p, 'stats');
  const aiBtn = await p.$('#aiBtn, [data-ai], #statsAiBtn');
  console.log('pulsante AI', !!aiBtn);
  // sincronizzazione + MCP + Telegram sui dati reali
  await tab(p, 'workout');
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1800);
  const code = (await p.textContent('#syncCodeShow')).trim();
  check(/Sincronizzato/.test(await p.textContent('#syncStatus')), 'sincronizzato: ' + await p.textContent('#syncStatus'));
  await p.click('#mcpOnBtn'); await p.waitForTimeout(900);
  const token = (await p.textContent('#mcpBearer')).replace('Bearer ', '').trim();
  const rpc = async (name, args) => { const r = await fetch(`${BASE}/mcp/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }) }); return (await r.json()).result; };
  for (const [n, a] of [['riepilogo'], ['volume_muscoli', { settimane: 6 }], ['record', { limite: 12 }], ['storico_esercizio', { esercizio: 'chest press' }], ['allenamenti', { limite: 2 }], ['scheda']]) {
    const r = await rpc(n, a); fs.writeFileSync(OUT + '/mcp-' + n + '.txt', r.content[0].text);
    check(!r.isError, n + ' (' + r.content[0].text.length + ' caratteri)');
  }
  await p.fill('#tgToken', '123456789:' + 'A'.repeat(31) + 'GOOD'); await p.click('#tgOnBtn'); await p.waitForTimeout(1200);
  const calls = JSON.parse(await (await fetch(BASE + '/__ctl?tglog=1')).text()), doc = calls.find(c => c.method === 'sendDocument');
  check(!!doc, 'Telegram: backup inviato, ' + (doc ? Math.round(doc.body.document.size / 1024) + ' KB' : '-'));
  const nApp = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('palestra:logs'))).flat().length);
  check(nApp === NLOGS + 1, `nell'app ${nApp} allenamenti: quelli importati + quello appena fatto`);
  if (doc) { const f = JSON.parse(doc.body.document.text); check(Object.values(f.logs).flat().length === nApp && f.settings.aiContext && f.settings.fileBackupAfter === false, `file Telegram: tutti i ${nApp} allenamenti, impostazioni complete`); console.log('didascalia:', doc.body.caption.replace(/\n/g, ' | ')); }
  console.log('tempo totale', Date.now() - t0, 'ms');
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
