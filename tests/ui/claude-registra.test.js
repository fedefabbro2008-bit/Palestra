// registra_allenamento nell'app: l'allenamento registrato da Claude arriva identico a quello del server, l'avviso dice
// cosa e perché, Progressi lo conta; «Rimetti com'era» lo toglie e «Rifai» lo rimette; l'annullo dal connettore lo toglie
// anche dal telefono; il testo dell'interruttore dice che Claude può registrare un allenamento
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const path = require('path');
const OUT = process.argv[2], BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const SDK = path.join(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/esm');
function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
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
  // interruttore nell'app, con il testo nuovo
  await p.click('#settingsClose'); await p.waitForTimeout(300); await p.click('#settingsBtn'); await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('mcpCard').scrollIntoView()); await p.waitForTimeout(300);
  await p.click('label.switch:has(#mcpLogsToggle)'); await p.waitForTimeout(900);
  const sub = await p.textContent('#mcpLogsSub');
  check(await p.isChecked('#mcpLogsToggle') && /registra un allenamento che non hai segnato/.test(sub) && !/mai allenamenti creati/.test(sub), 'interruttore acceso, il testo dice che Claude può registrare un allenamento: ' + sub.slice(0, 90));
  await p.click('#settingsClose'); await p.waitForTimeout(300);

  const L0 = await appLogs(), days = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:days')));
  const planEx = days.A.exercises.find((e) => e.muscle && e.muscle !== 'Altro' && e.sets > 0 && (!e.type || e.type === 'reps'));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  let iso = today; do { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); iso = d.toISOString().slice(0, 10); } while (L0[iso]);
  const xtCount = async (name) => { await tab(p, 'plan'); await p.waitForTimeout(400); if (await p.$('#exTableMore[aria-expanded="false"]')) { await p.click('#exTableMore'); await p.waitForTimeout(200); }
    return p.evaluate((n) => { const r = [...document.querySelectorAll('#exTable .xt-row')].find((x) => x.querySelector('.xt-name b').textContent === n); return r ? parseInt(r.querySelector('.xt-name small').textContent, 10) : 0; }, name); };
  const n0 = await xtCount(planEx.name);
  await tab(p, 'workout');

  // Claude registra un allenamento dimenticato
  let r = await call('registra_allenamento', { data: iso, ora: '08:15', durata: 45, giornata: 'A', nota: 'telefono scarico', motivo: 'Allenamento di ieri non segnato',
    esercizi: [{ nome: planEx.name, serie: [{ kg: 30, ripetizioni: 10 }, { kg: 30, ripetizioni: 9, rpe: 9 }] }, { nome: 'Croci ai cavi alti (prova)', muscolo: 'Petto', serie: [{ kg: 12, ripetizioni: 12 }] }] });
  check(!r.err, 'registrato dal connettore: ' + r.t.split('\n')[0]);
  const bS = await blob();
  await p.reload(); await p.waitForTimeout(3000);
  const L1 = await appLogs();
  const s = (L1[iso] || [])[0];
  check(stableStr(L1) === stableStr(bS.logs) && s && s.note === 'telefono scarico' && s.dayKey === 'A', 'nell\'app lo storico è identico a quello del server, con l\'allenamento registrato');
  const card = (await p.textContent('#claudeLogCard')).replace(/\s+/g, ' ');
  check(card.includes(`registrato l'allenamento del ${dmy(iso)} delle 08:15`) && /Allenamento di ieri non segnato/.test(card) && card.includes(planEx.name + ': 30×10') && /· 1 correzione/.test(card), 'avviso: «registrato l\'allenamento del …», motivo ed esercizi con le serie, conta 1 correzione');
  await p.locator('#claudeLogCard').screenshot({ path: OUT + '/avviso.png' });
  const n1 = await xtCount(planEx.name);
  check(n1 === n0 + 1, `Progressi lo conta: ${planEx.name} ${n0} → ${n1} sedute`);
  await tab(p, 'workout');

  // Rimetti com'era nell'app: tolto; Rifai: rimesso
  await p.click('#claudeLogMore').catch(() => {});
  await p.click('#claudeLogUndo'); await p.waitForTimeout(300); await p.click('#confirmYes'); await p.waitForTimeout(700);
  check(stableStr(await appLogs()) === stableStr(L0) && !(await p.textContent('#claudeLogCard')).trim(), 'Rimetti com\'era: l\'allenamento registrato sparisce, storico come prima, avviso sparito');
  await p.click('#toastAct'); await p.waitForTimeout(600);
  check(stableStr(await appLogs()) === stableStr(L1), 'Rifai: di nuovo come dopo Claude');
  await p.click('#settingsBtn'); await p.waitForTimeout(300); await p.click('#syncNowBtn'); await p.waitForTimeout(1500); await p.click('#settingsClose').catch(() => {});

  // annullo dal connettore: arriva al telefono
  r = await call('annulla_correzione_storico');
  check(!r.err && /Fatto/.test(r.t), 'annulla dal connettore: ' + r.t.slice(0, 80));
  await p.reload(); await p.waitForTimeout(3000);
  check(stableStr(await appLogs()) === stableStr(L0), 'nell\'app: l\'allenamento registrato non c\'è più, storico come all\'inizio');
  check(/rimesso lo storico/.test(await p.textContent('#claudeLogCard')), 'avviso «Claude ha rimesso lo storico com\'era»');
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
