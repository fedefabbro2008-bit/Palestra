// correggi_storico: permesso separato, correzione, valori ricalcolati, arrivo nell'app con avviso, niente rimbalzi,
// Rimetti com'era nell'app, annulla dal connettore, conflitto con una modifica fatta sul telefono
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const path = require('path');
const OUT = process.argv[2], BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const SDK = path.join(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/esm');
(async () => {
  const { Client } = await import(SDK + '/client/index.js');
  const { StreamableHTTPClientTransport } = await import(SDK + '/client/streamableHttp.js');
  await fetch(BASE + '/__ctl?reset=1');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  const blob = async () => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
  const key = async (body) => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
  const on = await key({ action: 'on' });
  check(on.write === false && on.writeLogs === false, 'chiave nuova: niente scrittura (write e writeLogs spenti)');
  await key({ action: 'write', on: true });
  const c = new Client({ name: 'prova', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
  const tools = (await c.listTools()).tools.map(t => t.name);
  check(tools.includes('correggi_storico') && tools.includes('annulla_correzione_storico'), 'strumenti elencati');
  const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text }; };
  // un esercizio con almeno 2 serie di lavoro nel penultimo allenamento
  let b0 = await blob();
  const isos = Object.keys(b0.logs).sort(), iso = isos[isos.length - 2], s0 = b0.logs[iso][0];
  const ei = s0.entries.findIndex(e => e.detail.filter(d => !d.w).length >= 2 && (e.type || 'reps') === 'reps');
  const e0 = s0.entries[ei], n2 = e0.detail.findIndex((d, k) => !d.w && k > 0) + 1, d2 = e0.detail[n2 - 1];
  const fix = { motivo: 'Ripetizioni scritte male', correzioni: [{ data: iso, esercizio: e0.name, serie: n2, da: { kg: d2.kg || 0, ripetizioni: d2.val }, a: { kg: (d2.kg || 0) + 50, ripetizioni: 3 } }] };
  // scheda sì, storico no: rifiutato
  let r = await call('correggi_storico', fix);
  check(r.err && /correggere lo storico/.test(r.t), 'con solo «modifica la scheda» acceso: rifiutato');
  // interruttore nell'app
  await p.click('#settingsClose'); await p.waitForTimeout(300); await p.click('#settingsBtn'); await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('mcpCard').scrollIntoView()); await p.waitForTimeout(300);
  await p.click('label.switch:has(#mcpLogsToggle)'); await p.waitForTimeout(900);
  check(await p.isChecked('#mcpLogsToggle') && /Acceso/.test(await p.textContent('#mcpLogsSub')), 'interruttore «Claude può correggere lo storico» acceso dall\'app');
  await p.locator('#mcpCard').screenshot({ path: OUT + '/s1-interruttori.png' });
  // «da» sbagliato: niente salvato
  const rev0 = (await blob()).rev;
  r = await call('correggi_storico', { ...fix, correzioni: [{ ...fix.correzioni[0], da: { kg: 999, ripetizioni: 1 } }] });
  check(r.err && /non quella che indichi/.test(r.t) && (await blob()).rev === rev0, '«da» che non coincide: errore, niente salvato');
  r = await call('correggi_storico', { motivo: 'x', correzioni: [{ data: iso, esercizio: 'Inesistente', serie: 1, da: { kg: 0 } }] });
  check(r.err && /Quel giorno:/.test(r.t), 'esercizio sbagliato: elenca quelli del giorno');
  // correzione + serie aggiunta
  r = await call('correggi_storico', { ...fix, correzioni: [fix.correzioni[0], { data: iso, esercizio: e0.name, operazione: 'aggiungi', a: { kg: 10, ripetizioni: 12, tipo: 'riscaldamento' } }] });
  console.log(r.t.split('\n').slice(0, 6).join(' | '));
  const b1 = await blob(), e1 = b1.logs[iso][0].entries[ei];
  check(!r.err && e1.detail[n2 - 1].val === 3 && e1.detail[n2 - 1].kg === (d2.kg || 0) + 50 && e1.detail.length === e0.detail.length + 1, 'salvato sul server');
  check(e1.kg === (d2.kg || 0) + 50 && e1.val === 3 && e1.tonnage > 0, 'kg e ripetizioni migliori ricalcolati (' + e1.kg + '×' + e1.val + ', peso sollevato ' + e1.tonnage + ')');
  check(b1.claudeLog && b1.claudeLog.ids.includes(String(s0.id)) && JSON.stringify(b1.days) === JSON.stringify(b0.days) && !b1.claude, 'segno claudeLog, scheda e segno della scheda intatti');
  const st = await call('storico_esercizio', { esercizio: e0.name });
  check(st.t.includes(String((d2.kg || 0) + 50).replace('.', ',') + '×3'), 'storico_esercizio mostra il valore corretto');
  // arriva nell'app
  await p.click('#syncNowBtn'); await p.waitForTimeout(1500);
  const loc = await p.evaluate(({ iso, ei }) => JSON.parse(localStorage.getItem('palestra:logs'))[iso][0].entries[ei], { iso, ei });
  check(loc.detail.length === e0.detail.length + 1 && loc.kg === e1.kg && loc.val === 3, 'nell\'app: allenamento corretto (' + loc.kg + '×' + loc.val + ')');
  const t1 = await p.evaluate(() => document.getElementById('toastMsg').textContent);
  check(/Claude ha corretto lo storico/.test(t1), 'avviso: ' + t1);
  const rev1 = (await blob()).rev;
  await p.click('#syncNowBtn'); await p.waitForTimeout(1200);
  check((await blob()).rev === rev1, 'nessun rimbalzo: una seconda sincronizzazione non riscrive (rev ' + rev1 + ')');
  await p.click('#settingsClose').catch(() => {}); await p.waitForTimeout(300);
  await p.click('nav.bottom button[data-tab="workout"]'); await p.waitForTimeout(300);
  const card = await p.textContent('#claudeLogCard');
  check(/Claude ha corretto lo storico/.test(card) && /Ripetizioni scritte male/.test(card) && /serie aggiunta/.test(card), 'riquadro in Allenamento con motivo e correzioni');
  await p.locator('#claudeLogCard').screenshot({ path: OUT + '/s2-riquadro.png' });
  // record in Progressi coerente: il record dell'esercizio è ora il carico corretto
  // Rimetti com'era dall'app
  await p.click('#claudeLogUndo'); await p.waitForTimeout(300); await p.click('#confirmYes'); await p.waitForTimeout(600);
  const loc2 = await p.evaluate(({ iso, ei }) => JSON.parse(localStorage.getItem('palestra:logs'))[iso][0].entries[ei], { iso, ei });
  check(loc2.detail.length === e0.detail.length && JSON.stringify(loc2.detail[n2 - 1].val) === JSON.stringify(d2.val) && !(await p.textContent('#claudeLogCard')).trim(), 'Rimetti com\'era: allenamento come prima, riquadro sparito');
  await p.waitForTimeout(4000);   // la sincronizzazione parte da sola dopo la modifica
  const b2 = await blob();
  check(b2.logs[iso][0].entries[ei].detail.length === e0.detail.length, 'e arriva anche sul server');
  r = await call('annulla_correzione_storico');
  check(r.err && /cambiato dopo/.test(r.t), 'annulla dal connettore dopo il ripristino nell\'app: rifiutato (' + r.t.slice(0, 60) + ')');
  // correzione e annulla dal connettore
  r = await call('correggi_storico', fix);
  check(!r.err, 'nuova correzione');
  r = await call('annulla_correzione_storico');
  const b3 = await blob();
  check(!r.err && b3.logs[iso][0].entries[ei].detail[n2 - 1].val === d2.val && b3.claudeLog.undo === true, 'annulla dal connettore: rimesso com\'era');
  // conflitto: correzione di Claude, ma sul telefono lo stesso allenamento cambiato prima di sincronizzare
  r = await call('correggi_storico', fix);
  await p.evaluate(({ iso }) => { const l = JSON.parse(localStorage.getItem('palestra:logs')); l[iso][0].note = 'cambiato sul telefono'; localStorage.setItem('palestra:logs', JSON.stringify(l)); }, { iso });
  await p.reload(); await p.waitForTimeout(3500);
  const tm = await p.evaluate(() => document.getElementById('toastMsg').textContent);
  const loc3 = await p.evaluate(({ iso }) => JSON.parse(localStorage.getItem('palestra:logs'))[iso][0], { iso });
  check(/non applicata/.test(tm) && loc3.note === 'cambiato sul telefono', 'conflitto: vale la versione del telefono e lo dice (' + tm + ')');
  // permesso spento: di nuovo rifiutato
  await key({ action: 'writeLogs', on: false });
  r = await call('correggi_storico', fix);
  check(r.err && /correggere lo storico/.test(r.t), 'interruttore spento: rifiutato subito');
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404|409/.test(x))));
  await A.browser.close();
})();
