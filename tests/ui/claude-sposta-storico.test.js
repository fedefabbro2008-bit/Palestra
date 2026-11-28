// sposta_storico ed elimina_storico_esercizio nell'app: le due modifiche arrivano insieme (app non aperta fra le due),
// avviso con «eliminate N serie di X il …» e «spostate N serie da X a Y il …», dati uguali al server, conteggi ricalcolati
// in Progressi; «Rimetti com'era» (anche un allenamento eliminato) e «Rifai»; annullo dal connettore dopo quello
// dell'app; rifiuto se l'app ha cambiato quegli allenamenti; Backup completo esportato e reimportato senza perdite
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const path = require('path'), fs = require('fs');
const OUT = process.argv[2], BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const SDK = path.join(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/esm');
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const CP = 'Chest press macchina · presa neutra', PD = 'Pec deck';
(async () => {
  const { Client } = await import(SDK + '/client/index.js');
  const { StreamableHTTPClientTransport } = await import(SDK + '/client/streamableHttp.js');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 6 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  const blob = async () => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
  const key = async (body) => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
  const on = await key({ action: 'on' });
  const c = new Client({ name: 'prova', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
  const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text }; };
  const appLogs = () => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:logs')));
  const flat = (logs) => Object.keys(logs).sort().flatMap((iso) => logs[iso].map((s) => ({ iso, s })));
  const dates = (logs, name) => [...new Set(flat(logs).filter((x) => x.s.entries.some((e) => fold(e.name) === fold(name))).map((x) => x.iso))];
  // permesso spento: errore
  let r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: PD, motivo: 'x' });
  check(r.err && /correggere lo storico/.test(r.t), 'permesso spento: errore chiaro');
  // interruttore nell'app
  await p.click('#settingsClose'); await p.waitForTimeout(300); await p.click('#settingsBtn'); await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('mcpCard').scrollIntoView()); await p.waitForTimeout(300);
  await p.click('label.switch:has(#mcpLogsToggle)'); await p.waitForTimeout(900);
  check(await p.isChecked('#mcpLogsToggle'), 'interruttore «Claude può correggere lo storico» acceso');
  await p.click('#settingsClose'); await p.waitForTimeout(300);

  // un allenamento con il solo Pec deck, arrivato da un altro dispositivo (per l'eliminazione con flag)
  let b = await blob();
  const pdPlan = Object.values(b.days).flatMap((d) => d.exercises).find((e) => e.name === PD);
  const eIso = Object.keys(b.logs).sort()[0].slice(0, 8) + '01', eId = 'solo-pec-deck';
  const logs1 = JSON.parse(JSON.stringify(b.logs)); (logs1[eIso] = logs1[eIso] || []).push({ id: eId, dayKey: 'B', dayName: 'Prova', startedAt: Date.parse(eIso + 'T16:00:00Z'), endedAt: Date.parse(eIso + 'T16:20:00Z'), entries: [{ exId: pdPlan.id, name: PD, muscle: 'Petto', val: 10, kg: 30, detail: [{ kg: 30, val: 10, at: Date.parse(eIso + 'T16:05:00Z') }] }] });
  await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: b.rev, logs: logs1, days: b.days, daysAt: b.daysAt, settings: b.settings, setAt: b.setAt, wid: 'altro' }) });
  await p.reload(); await p.waitForTimeout(2500);
  const L0 = await appLogs();
  check(!!flat(L0).find((x) => x.s.id === eId), 'allenamento di prova arrivato nell\'app');
  const pdD = dates(L0, PD).filter((iso) => iso !== eIso), cpD = dates(L0, CP);
  const xtCount = async (name) => { await tab(p, 'plan'); await p.waitForTimeout(400); if (await p.$('#exTableMore[aria-expanded="false"]')) { await p.click('#exTableMore'); await p.waitForTimeout(200); }
    return p.evaluate((n) => { const r = [...document.querySelectorAll('#exTable .xt-row')].find((x) => x.querySelector('.xt-name b').textContent === n); return r ? parseInt(r.querySelector('.xt-name small').textContent, 10) : 0; }, name); };
  const pd0 = await xtCount(PD), cp0 = await xtCount(CP);
  await tab(p, 'workout');

  // due modifiche di Claude mentre l'app non sincronizza: prima elimina, poi sposta
  r = await call('elimina_storico_esercizio', { esercizio: PD, date: [pdD[0], eIso], elimina_allenamento_vuoto: true, motivo: 'Vecchie sedute di Pec deck' });
  check(!r.err, 'elimina dal connettore: ' + r.t.split('\n')[0]);
  r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: cpD.slice(0, 2), motivo: 'Erano Pec deck' });
  check(!r.err, 'sposta dal connettore: ' + r.t.split('\n')[0]);
  const bS = await blob();
  await p.reload(); await p.waitForTimeout(3000);
  const L1 = await appLogs();
  check(stableStr(L1) === stableStr(bS.logs), 'nell\'app lo storico è identico a quello del server dopo le due modifiche');
  check(!flat(L1).find((x) => x.s.id === eId) && !dates(L1, PD).includes(pdD[0]) && cpD.slice(0, 2).every((iso) => !dates(L1, CP).includes(iso) && dates(L1, PD).includes(iso)), 'nell\'app: Pec deck tolto, allenamento vuoto eliminato, Chest press spostata');
  const card = await p.textContent('#claudeLogCard');
  const nDel = flat(L0).filter((x) => x.iso === pdD[0]).flatMap((x) => x.s.entries).filter((e) => e.name === PD).reduce((a, e) => a + e.detail.length, 0);
  check(card.includes(`eliminate ${nDel} serie di ${PD} il ${dmy(pdD[0])}`) && /eliminato l'allenamento del/.test(card) && cpD.slice(0, 2).every((iso) => new RegExp(`spostate \\d+ serie.* da ${CP} a ${PD} il ${dmy(iso).replace(/\//g, '\\/')}`).test(card)), 'avviso con tutte e due le modifiche: «eliminate N serie di…», «eliminato l\'allenamento…», «spostate N serie da … a …»');
  check(/Vecchie sedute di Pec deck/.test(card) && /Erano Pec deck/.test(card), 'avviso con i due motivi');
  await p.locator('#claudeLogCard').screenshot({ path: OUT + '/avviso.png' });
  // conteggi ricalcolati dall'app (Progressi): Pec deck −1 seduta tolta, +2 spostate; Chest press −2
  const pd1 = await xtCount(PD), cp1 = await xtCount(CP);
  check(pd1 === pd0 - 2 + 2 && cp1 === cp0 - 2, `Progressi ricalcolato: Pec deck ${pd0} → ${pd1} sedute (−2 eliminate, +2 spostate), Chest press ${cp0} → ${cp1}`);
  await tab(p, 'workout');

  // Rimetti com'era nell'app: tutto come prima, anche l'allenamento eliminato; poi Rifai
  await p.click('#claudeLogMore').catch(() => {});
  await p.click('#claudeLogUndo'); await p.waitForTimeout(300); await p.click('#confirmYes'); await p.waitForTimeout(700);
  const L2 = await appLogs();
  check(stableStr(L2) === stableStr(L0) && !(await p.textContent('#claudeLogCard')).trim(), 'Rimetti com\'era: storico identico a prima delle due modifiche (allenamento eliminato rimesso), avviso sparito');
  await p.click('#toastAct'); await p.waitForTimeout(600);
  check(stableStr(await appLogs()) === stableStr(L1), 'Rifai: di nuovo come dopo Claude');
  await p.click('#settingsBtn'); await p.waitForTimeout(300); await p.click('#syncNowBtn'); await p.waitForTimeout(1500); await p.click('#settingsClose').catch(() => {});
  // annullo dal connettore (la pila: prima sposta, poi elimina)
  r = await call('annulla_correzione_storico');
  check(!r.err && /Fatto/.test(r.t) && /ancora 1 modifica/.test(r.t), 'annulla dal connettore: tolto lo spostamento (ne resta una)');
  r = await call('annulla_correzione_storico');
  check(!r.err && /Fatto/.test(r.t), 'annulla di nuovo: rimessa anche l\'eliminazione');
  await p.reload(); await p.waitForTimeout(3000);
  check(stableStr(await appLogs()) === stableStr(L0), 'nell\'app: storico tornato identico all\'inizio, anche l\'allenamento eliminato');
  check(/rimesso lo storico/.test(await p.textContent('#claudeLogCard')), 'avviso «Claude ha rimesso lo storico com\'era»');
  await p.click('#claudeLogOk').catch(() => {});

  // rifiuto: l'app cambia un allenamento spostato dopo Claude
  r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: [cpD[2]], motivo: 'prova conflitto' });
  await p.reload(); await p.waitForTimeout(3000);
  // modifica fatta nell'app: una nota all'allenamento, salvata e sincronizzata come fa l'app
  const sid = flat(await appLogs()).find((x) => x.iso === cpD[2] && x.s.entries.some((e) => e.name === PD)).s.id;
  const bb = await blob(); const lg = JSON.parse(JSON.stringify(bb.logs)); lg[cpD[2]].find((s) => s.id === sid).note = 'cambiata a mano';
  await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: bb.rev, logs: lg, days: bb.days, daysAt: bb.daysAt, settings: bb.settings, setAt: bb.setAt, wid: 'altro' }) });
  r = await call('annulla_correzione_storico');
  check(r.err && /cambiato dopo/.test(r.t), 'annullo rifiutato: l\'allenamento è stato cambiato dopo Claude');

  // Backup completo esportato e reimportato su un telefono nuovo: niente perso
  await p.reload(); await p.waitForTimeout(3000);
  const Lf = await appLogs();
  await p.click('#settingsBtn'); await p.waitForTimeout(400);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportAllBtn')]);
  const file = path.join(OUT, 'backup.json'); await dl.saveAs(file);
  const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(stableStr(exp.logs) === stableStr(Lf), 'Backup completo: storico identico a quello dell\'app');
  const B = await open({ browser: A.browser, ls: {} });
  await B.page.click('#settingsBtn'); await B.page.waitForTimeout(300);
  B.page.on('dialog', (d) => d.accept());
  await B.page.setInputFiles('#importFile', file); await B.page.waitForTimeout(800);
  if (await B.page.isVisible('#confirmOverlay.show')) { await B.page.click('#confirmYes'); await B.page.waitForTimeout(800); }
  const Lb = await B.page.evaluate(() => JSON.parse(localStorage.getItem('palestra:logs')));
  const keyOf = (logs) => flat(logs).map(({ iso, s }) => iso + '|' + s.id + '|' + stableStr(s.entries.map((e) => [e.name, e.exId, e.muscle || 'Altro', e.secondary || null, e.detail]))).join('\n');
  check(keyOf(Lb) === keyOf(Lf), 'reimportato su un telefono nuovo: stessi allenamenti, esercizi, muscoli e serie');
  const errs = A.errors.concat(B.errors).filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await c.close(); await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
