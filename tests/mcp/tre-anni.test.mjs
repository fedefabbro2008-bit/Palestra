// connettore con 3 anni di storico (circa 470 allenamenti, generati qui): ogni lettura risponde senza errori, entro la
// lunghezza massima e in un tempo ragionevole; esporta a pezzi (giorni interi) ridà tutte le serie, senza doppioni
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
const BASE = 'http://localhost:8888';
const code = fs.readFileSync(process.argv[2], 'utf8').trim();
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const blob = async () => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
const key = async (body) => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());

// 3 anni: 3 sedute a settimana a rotazione sulle giornate della scheda, carichi che salgono piano, qualche nota
const b0 = await blob();
const keys = Object.keys(b0.days).filter((k) => !b0.days[k].spare);
const iso = (d) => d.toISOString().slice(0, 10);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const logs = {}, start = new Date(Date.now() - 156 * 7 * 864e5); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
let n = 0, rot = 0, nSets = 0;
for (let w = 0; w < 156; w++) for (const off of [0, 2, 4]) {
  const d = new Date(start.getTime() + (w * 7 + off) * 864e5); if (d.getTime() > Date.now() - 864e5) continue;
  const k = keys[rot++ % keys.length], day = b0.days[k];
  let t = d.getTime() + 17 * 3600e3;
  const entries = day.exercises.map((e) => {
    const detail = [];
    for (let i = 0; i < (e.warmups || 0); i++) detail.push({ kg: 10, val: 10, at: (t += 60e3), w: true });
    for (let i = 0; i < (e.sets || 0); i++) { const kg = e.muscle && e.muscle !== 'Altro' ? Math.round((20 + w * 0.3) * 2) / 2 : 0; detail.push(kg ? { kg, val: 8 + Math.floor(rnd() * 5), at: (t += 120e3), rpe: 7 + Math.floor(rnd() * 3) } : { val: e.type === 'time' ? 40 : 10, at: (t += 90e3) }); }
    nSets += detail.length;
    const o = { exId: e.id, name: e.name, val: 10, detail }; if (e.muscle && e.muscle !== 'Altro') o.muscle = e.muscle; if (e.secondary) o.secondary = e.secondary; if (e.type && e.type !== 'reps') o.type = e.type;
    return o;
  }).filter((e) => e.detail.length);
  (logs[iso(d)] = logs[iso(d)] || []).push({ id: 'tre' + n++, dayKey: k, dayName: day.name, startedAt: d.getTime() + 17 * 3600e3, endedAt: t + 60e3, ...(rnd() < 0.1 ? { note: 'Nota di prova numero ' + n } : {}), entries });
}
const r0 = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: b0.rev, logs, days: b0.days, daysAt: b0.daysAt, settings: b0.settings, setAt: b0.setAt, wid: 'app-prova' }) });
const size = JSON.stringify(logs).length;
check(r0.ok, `3 anni salvati come dall'app: ${n} allenamenti, ${nSets} serie, ${Math.round(size / 1024)} KB`);

await key({ action: 'off' });
const on = await key({ action: 'on' });
const c = new Client({ name: 'prova', version: '1.0.0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
const call = async (name, args) => { const t0 = performance.now(); const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text, ms: Math.round(performance.now() - t0) }; };
const first = Object.keys(logs).sort()[0];
const reads = [['riepilogo', {}], ['scheda', {}], ['allenamenti', { limite: 60 }], ['allenamenti', { limite: 200, formato: 'compatto' }], ['storico_esercizio', { esercizio: b0.days[keys[0]].exercises.find((e) => e.muscle && e.muscle !== 'Altro').name, limite: 100 }],
  ['volume_muscoli', { settimane: 26 }], ['record', { limite: 200 }], ['confronta_periodi', { giorni: 365 }], ['confronta_periodi', { a_dal: first, a_al: '2025-12-31' }], ['analisi_scheda', { settimane: 12 }],
  ['progressione_suggerita', {}], ['cerca_note', { limite: 100 }], ['esporta', {}]];
const times = [];
for (const [name, args] of reads) {
  const r = await call(name, args);
  times.push(`${name} ${r.ms} ms`);
  check(!r.err && r.t.length <= 60200 && r.ms < 4000, `${name} ${JSON.stringify(args)}: ${r.t.length} caratteri in ${r.ms} ms${r.err ? ' — ' + r.t.slice(0, 120) : ''}`);
}
// allenamenti: mai tagliati a metà; si fermano a giorni interi e dicono da dove continuare, senza buchi né doppioni
for (const args of [{ limite: 60 }, { limite: 200, formato: 'compatto' }]) {
  const r = await call('allenamenti', args), m = /al = (\d{4}-\d{2}-\d{2})/.exec(r.t);
  const shown = (r.t.match(/^## /gm) || []).length, said = +((/mostrati i (\d+) più recenti/.exec(r.t) || [])[1] || 0);
  const r2 = m ? await call('allenamenti', { ...args, al: m[1] }) : null;
  const firstNext = r2 ? (/^## (\d\d\/\d\d)/m.exec(r2.t) || [])[1] : null, lastHere = ([...r.t.matchAll(/^## (\d\d\/\d\d)/gm)].pop() || [])[1];
  const all = Object.keys(logs).sort().reverse().flatMap((d) => logs[d].map(() => d)), nextIso = all[shown];
  check(!/risposta tagliata/.test(r.t) && r.t.length <= 60000 && m && said === shown && firstNext === nextIso.slice(8, 10) + '/' + nextIso.slice(5, 7) && lastHere !== firstNext,
    `allenamenti ${JSON.stringify(args)}: ${shown} interi in ${r.t.length} caratteri, si continua con al = ${m && m[1]} dal ${firstNext} (nessun buco, nessun doppione)`);
}

// esporta a pezzi fino alla fine: tutte le serie, nessun giorno due volte
let dal = null, rows = 0, calls = 0, days = new Set(), dup = 0, ms = 0;
for (;;) {
  const r = await call('esporta', dal ? { dal } : {}); calls++; ms += r.ms;
  const csv = (/```csv\n([\s\S]*?)\n```/.exec(r.t) || [])[1] || '';
  const lines = csv.split('\n').slice(1), here = new Set(lines.map((l) => l.slice(0, 10)));
  here.forEach((d) => { if (days.has(d)) dup++; days.add(d); });
  rows += lines.length;
  const m = /dal = (\d{4}-\d{2}-\d{2})/.exec(r.t);
  if (!m || calls > 200) break;
  dal = m[1];
}
check(rows === nSets && dup === 0, `esporta a pezzi: ${rows} righe su ${nSets} serie in ${calls} chiamate (${ms} ms in tutto), nessun giorno ripetuto`);
console.log('tempi: ' + times.join(' · '));
