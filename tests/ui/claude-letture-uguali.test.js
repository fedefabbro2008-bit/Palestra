// il connettore e l'app dicono le stesse cose: per ogni giornata i consigli di progressione_suggerita sono identici a
// quelli che l'app prepara all'inizio dell'allenamento (aumenta, continua, scala, fermo), ed esporta (anche a pezzi)
// dà lo stesso CSV di «Esporta → CSV» dell'app
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const path = require('path'), fs = require('fs');
const OUT = process.argv[2], BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const SDK = path.join(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/esm');
(async () => {
  const { Client } = await import(SDK + '/client/index.js');
  const { StreamableHTTPClientTransport } = await import(SDK + '/client/streamableHttp.js');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 10, rpe: true }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  await p.click('#settingsClose'); await p.waitForTimeout(300);
  const key = async (body) => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
  const on = await key({ action: 'on' });
  const c = new Client({ name: 'prova', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
  const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text }; };

  // consigli: giornata per giornata, l'allenamento appena iniziato nell'app contro il connettore
  const days = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:days')));
  const keys = Object.keys(days).filter((k) => !days[k].spare);
  let same = 0, kinds = new Set(), diff = [];
  for (const k of keys) {
    await p.evaluate((k) => document.querySelector(`.day-pill[data-k="${k}"]`).click(), k); await p.waitForTimeout(300);
    await p.click('#startSessionBtn'); await p.waitForTimeout(500);
    const sess = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session')));
    await p.click('#sessCancelBtn'); await p.waitForTimeout(200); await p.click('#confirmYes'); await p.waitForTimeout(400);
    const r = await call('progressione_suggerita', { giornata: k });
    const lines = r.t.split('\n').filter((l) => l.startsWith('- '));
    for (const e of sess.exercises) {
      if (e.muscle === 'Altro' || !(e.plan && e.plan.sets > 0)) continue;
      const l = lines.find((x) => x.startsWith(`- ${e.name} (scheda `));
      const m = l && / — (.*)$/.exec(l);
      let txt = m ? m[1].replace(/ \(ultima volta \d\d\/\d\d: [^)]*\)$/, '') : null;
      const kind = l && (/: (AUMENTA|SCALA|FERMO|CONTINUA) — /.exec(l) || [])[1];
      const ok = e.hint ? (txt === e.hint && ({ up: 'AUMENTA', down: 'SCALA', stall: 'FERMO', keep: 'CONTINUA' })[e.hintKind] === kind) : (!!l && /: (nessun consiglio|mai fatto) — /.test(l));
      if (ok) { same++; if (e.hintKind) kinds.add(e.hintKind); } else diff.push(`${e.name}: app «${e.hint}» / connettore «${txt || l}»`);
    }
  }
  check(same >= 12 && !diff.length, `consigli identici all'app in ${same} esercizi (tipi: ${[...kinds].join(', ')})${diff.length ? ' — diversi: ' + diff.slice(0, 3).join(' | ') : ''}`);
  check(kinds.has('up') && kinds.has('keep'), 'fra i consigli confrontati ci sono sia «aumenta» sia «continua»');

  // CSV: l'app («Esporta → CSV») e il connettore (a pezzi se serve) uguali riga per riga
  await p.click('#settingsBtn'); await p.waitForTimeout(400);
  const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('#backupMoreBtn'); await p.click('#exportCsvBtn'); })()]);
  const app = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  let rows = null, dal = null, calls = 0;
  for (;;) {
    const r = await call('esporta', dal ? { dal } : {}); calls++;
    const csv = ((/```csv\n([\s\S]*?)\n```/.exec(r.t) || [])[1] || '').split('\n');
    rows = rows ? rows.concat(csv.slice(1)) : csv;
    const m = /dal = (\d{4}-\d{2}-\d{2})/.exec(r.t); if (!m || calls > 30) break; dal = m[1];
  }
  const bad = app.findIndex((l, i) => l !== rows[i]);
  check(app.length > 300 && app.length === rows.length && bad < 0, `CSV del connettore (${calls} pezzi) = CSV dell'app: ${rows.length} righe contro ${app.length}${bad >= 0 ? ` — prima differenza alla riga ${bad}: app «${app[bad]}» / connettore «${rows[bad]}»` : ''}`);
  const errs = A.errors.filter((x) => !/Service Worker|404/.test(x));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
