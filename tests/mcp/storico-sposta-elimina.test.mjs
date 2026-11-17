// sposta_storico, elimina_storico_esercizio e annulla_correzione_storico (connettore, Node + server di prova con le
// funzioni vere): permesso, input non validi (niente salvato), eliminazione, spostamento su esercizio della scheda,
// unione nello stesso allenamento in ordine di ora, esercizio nuovo, tutte le date, allenamento vuoto con e senza
// flag, avviso nell'app con tutte le modifiche non viste, ricalcoli, pila degli annulli e rifiuti
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
const BASE = 'http://localhost:8888';
const code = fs.readFileSync(process.argv[2], 'utf8').trim();
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const clone = (v) => JSON.parse(JSON.stringify(v));
function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const blob = async () => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
const key = async (body) => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
// un altro dispositivo (l'app) che salva: come fa syncNow
async function appSave(mut) {
  const b = await blob(); const logs = clone(b.logs); mut(logs);
  const r = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: b.rev, logs, days: b.days, daysAt: b.daysAt, settings: b.settings, setAt: b.setAt, wid: 'app-prova' }) });
  return r.ok;
}
const flat = (logs) => Object.keys(logs).sort().flatMap((iso) => logs[iso].map((s) => ({ iso, s })));
const withEx = (logs, name) => [...new Set(flat(logs).filter((x) => x.s.entries.some((e) => fold(e.name) === fold(name))).map((x) => x.iso))];
const entriesOf = (logs, name) => flat(logs).flatMap(({ iso, s }) => s.entries.filter((e) => fold(e.name) === fold(name)).map((e) => ({ iso, s, e })));

const CP = 'Chest press macchina · presa neutra', PD = 'Pec deck', NEW = 'Chest press inclinata alla macchina';
await key({ action: 'off' });
const on = await key({ action: 'on' });
const c = new Client({ name: 'prova', version: '1.0.0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text }; };
const tools = (await c.listTools()).tools;
const tSp = tools.find((t) => t.name === 'sposta_storico'), tEl = tools.find((t) => t.name === 'elimina_storico_esercizio'), tUn = tools.find((t) => t.name === 'annulla_correzione_storico');
check(tSp && tEl && tUn && !tSp.annotations.readOnlyHint && /UNA chiamata/.test(tSp.description) && /elimina_allenamento_vuoto/.test(tEl.description) && /fino a 10/.test(tUn.description), 'strumenti nuovi elencati con le descrizioni');
check(/sposta_storico/.test(c.getInstructions()) && /elimina_storico_esercizio/.test(c.getInstructions()), 'istruzioni del server con le operazioni nuove');

const b0 = await blob(), L0 = clone(b0.logs);
const cpDates = withEx(L0, CP), pdDates = withEx(L0, PD);
const pdPlan = Object.values(b0.days).flatMap((d) => d.exercises).find((e) => e.name === PD);
check(cpDates.length >= 6 && pdDates.length >= 3 && pdPlan, `dati di prova: ${CP} in ${cpDates.length} giorni, ${PD} in ${pdDates.length}`);

// --- permesso spento: errore chiaro, niente salvato
let r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: [cpDates[0]], motivo: 'prova' });
check(r.err && /correggere lo storico/.test(r.t) && (await blob()).rev === b0.rev, 'permesso spento: errore chiaro, niente salvato');
r = await call('elimina_storico_esercizio', { esercizio: PD, date: [pdDates[0]], motivo: 'prova' });
check(r.err && /correggere lo storico/.test(r.t), 'permesso spento anche per elimina');
await key({ action: 'writeLogs', on: true });

// --- input non validi: errore che dice cosa, nessuna modifica
const bads = [
  ['sposta senza motivo', 'sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: [cpDates[0]] }, /motivo/],
  ['stesso esercizio (maiuscole e spazi diversi)', 'sposta_storico', { esercizio_da: CP, esercizio_a: '  CHEST press  macchina · presa NEUTRA ', motivo: 'x' }, /stesso esercizio/],
  ['data impossibile', 'sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: ['2026-13-40'], motivo: 'x' }, /non è valida/],
  ['data senza l\'esercizio di partenza', 'sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: [cpDates[0], pdDates[0]], motivo: 'x' }, new RegExp('non c\'è il ' + dmy(pdDates[0]).replace(/\//g, '\\/'))],
  ['nome non testo', 'sposta_storico', { esercizio_da: 42, esercizio_a: PD, motivo: 'x' }, /esercizio_da/],
  ['date non elenco', 'sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: 20260928, motivo: 'x' }, /elenco/],
  ['esercizio nuovo senza muscolo', 'sposta_storico', { esercizio_da: CP, esercizio_a: NEW, date: [cpDates[0]], motivo: 'x' }, /indica «muscolo»/],
  ['muscolo inesistente', 'sposta_storico', { esercizio_da: CP, esercizio_a: NEW, date: [cpDates[0]], muscolo: 'Gambe', motivo: 'x' }, /muscolo/],
  ['muscolo diverso da quello in scheda', 'sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: [cpDates[0]], muscolo: 'Schiena', motivo: 'x' }, /già Petto/],
  ['tipi diversi (tempo su ripetizioni)', 'sposta_storico', { esercizio_da: 'Tricipiti', esercizio_a: PD, motivo: 'x' }, /tipi diversi|non c'è/],
  ['nome lunghissimo', 'sposta_storico', { esercizio_da: 'x'.repeat(500), esercizio_a: PD, motivo: 'x' }, /troppo lungo/],
  ['nome che non esiste (__proto__)', 'sposta_storico', { esercizio_da: '__proto__', esercizio_a: PD, motivo: 'x' }, /non c'è/],
  ['troppe date', 'sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: Array.from({ length: 121 }, (_, i) => `2025-01-${String(1 + (i % 28)).padStart(2, '0')}`).concat(['2024-01-01']), motivo: 'x' }, /al massimo|non c'è/],
  ['elimina senza date', 'elimina_storico_esercizio', { esercizio: PD, motivo: 'x' }, /date/],
  ['elimina con flag non booleano', 'elimina_storico_esercizio', { esercizio: PD, date: [pdDates[0]], elimina_allenamento_vuoto: 'sì', motivo: 'x' }, /true o false/],
  ['elimina in una data senza l\'esercizio', 'elimina_storico_esercizio', { esercizio: PD, date: [pdDates[0], cpDates[0]], motivo: 'x' }, /non c'è/],
];
for (const [what, tool, args, rx] of bads) {
  const x = await call(tool, args); const b = await blob();
  check(x.err && /Nessuna modifica salvata/.test(x.t) && rx.test(x.t) && b.rev === b0.rev, `${what}: rifiutato, niente salvato — ${x.t.slice(0, 110)}`);
}

// --- 1. elimina Pec deck in due mercoledì (prima dello spostamento)
const delDates = pdDates.slice(0, 2);
const pdBefore = await call('storico_esercizio', { esercizio: PD, limite: 100 });
r = await call('elimina_storico_esercizio', { esercizio: '  pec   DECK ', date: delDates, motivo: 'Vecchie sedute di Pec deck da togliere' });
let b1 = await blob();
const delN = (iso) => entriesOf(L0, PD).filter((x) => x.iso === iso).reduce((a, x) => a + x.e.detail.length, 0);
check(!r.err && delDates.every((iso) => r.t.includes(`eliminate ${delN(iso)} serie di ${PD} il ${dmy(iso)}`)), 'elimina: righe «eliminate N serie di Pec deck il …» per ogni data');
check(delDates.every((iso) => !b1.logs[iso].some((s) => s.entries.some((e) => e.name === PD))) && withEx(b1.logs, PD).length === pdDates.length - 2, 'elimina: tolte solo in quelle date (maiuscole e spazi ignorati)');
check(delDates.every((iso) => b1.logs[iso].every((s, k) => stableStr(s.entries) === stableStr(L0[iso][k].entries.filter((e) => e.name !== PD)) && s.startedAt === L0[iso][k].startedAt && s.endedAt === L0[iso][k].endedAt && s.note === L0[iso][k].note)), 'elimina: gli altri esercizi, ore, durata e note intatti');
check(/Ricalcolato: Pec deck: prima \d+ sedute/.test(r.t), 'elimina: risposta con record e sedute di prima e di ora');

// --- 2. sposta Chest press → Pec deck in tre lunedì (date filtrate)
const mvDates = cpDates.slice(0, 3);
const cpBefore = new Map(entriesOf(L0, CP).map((x) => [x.s.id, x.e]));
r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: 'pec deck', date: mvDates, motivo: 'Serie registrate sull\'esercizio sbagliato' });
let b2 = await blob();
const moved = entriesOf(b2.logs, PD).filter((x) => mvDates.includes(x.iso));
check(!r.err && mvDates.every((iso) => new RegExp(`spostate \\d+ serie( \\(\\d+ di riscaldamento\\))? da ${CP} a ${PD} il ${dmy(iso).replace(/\//g, '\\/')}`).test(r.t)), 'sposta: righe «spostate N serie da X a Y il …»');
check(moved.length === mvDates.length && moved.every((x) => x.e.name === PD && x.e.exId === pdPlan.id && x.e.muscle === 'Petto' && !x.e.secondary && stableStr(x.e.detail) === stableStr(cpBefore.get(x.s.id).detail)), 'sposta: voci con nome, id, muscolo di Pec deck (Petto, senza Tricipiti) e serie identiche (kg, ripetizioni, tipo, RPE, ore)');
check(withEx(b2.logs, CP).length === cpDates.length - 3 && cpDates.slice(3).every((iso) => b2.logs[iso].some((s) => s.entries.some((e) => e.name === CP))), 'sposta: le altre date restano Chest press');
check(mvDates.every((iso) => b2.logs[iso].every((s, k) => s.startedAt === L0[iso][k].startedAt && s.endedAt === L0[iso][k].endedAt && s.note === L0[iso][k].note && s.entries.length === L0[iso][k].entries.length)), 'sposta: ore, durata, note e numero di esercizi intatti');
// ricalcoli: record e massimale di Pec deck calcolati qui, a mano, dalle serie
const best = (items) => { let b = null; for (const { iso, e } of items) for (const d of e.detail.filter((d) => !d.w && d.t !== 'd')) { const kg = d.kg || 0; if (!b || kg > b.kg || (kg === b.kg && d.val > b.val)) b = { kg, val: d.val, iso }; } return b; };
const e1 = (items) => Math.max(0, ...items.flatMap(({ e }) => e.detail.filter((d) => !d.w && d.t !== 'd' && (d.kg || 0) > 0 && d.val >= 1 && d.val <= 12).map((d) => Math.round((d.val === 1 ? d.kg : d.kg * (1 + d.val / 30)) * 10) / 10)));
const fnum = (n) => Number.isInteger(n) ? String(n) : String(+n.toFixed(2)).replace('.', ',');
const pdItems = entriesOf(b2.logs, PD), bb = best(pdItems), eb = e1(pdItems);
const hist = await call('storico_esercizio', { esercizio: PD, limite: 100 });
check(hist.t.includes(`Record: ${bb.kg ? fnum(bb.kg) + '×' : ''}${fnum(bb.val)} (${dmy(bb.iso)})`) && hist.t.includes(`massimale stimato migliore ${fnum(eb)} kg`) && hist.t.includes(`· ${pdItems.length} sedute`), `ricalcolo: record ${bb.kg}×${bb.val} e massimale ${eb} kg di Pec deck come calcolati a mano, ${pdItems.length} sedute`);
check(r.t.includes('Ricalcolati') && /Chest press macchina · presa neutra: prima \d+ sedute.*→ ora \d+ sedute/.test(r.t), 'sposta: risposta con il prima/dopo di tutti e due gli esercizi');
// serie per muscolo: i Tricipiti (secondario della Chest press, ½ serie) calano di metà delle serie di lavoro spostate
const work = (e) => e.detail.filter((d) => !d.w).length;
const triVol = (logs) => flat(logs).reduce((a, { s }) => a + s.entries.reduce((x, e) => x + (e.muscle === 'Tricipiti' ? work(e) : 0) + (e.secondary === 'Tricipiti' && e.muscle !== 'Altro' ? work(e) * 0.5 : 0), 0), 0);
const movedWork = moved.reduce((a, x) => a + work(x.e), 0);
check(Math.abs((triVol(b1.logs) - triVol(b2.logs)) - movedWork * 0.5) < 1e-9 && movedWork > 0, `ricalcolo serie per muscolo: Tricipiti −${movedWork * 0.5} (metà delle ${movedWork} serie spostate)`);
// l'app non si è aperta fra le due modifiche: il segno le contiene tutte e due
check(b2.claudeLog && Array.isArray(b2.claudeLog.items) && b2.claudeLog.items.length === 2 && b2.claudeLog.items[0].lines.some((x) => /^eliminate/.test(x)) && b2.claudeLog.items[1].lines.some((x) => /^spostate/.test(x)), 'avviso per l\'app: le due modifiche non ancora viste (eliminate + spostate)');

// --- 3. unione: in un lunedì c'è già Pec deck (fatto prima della Chest press): una voce sola, in ordine di ora
const mIso = cpDates[3];
await appSave((logs) => { const s = logs[mIso].find((x) => x.entries.some((e) => e.name === CP)); const cp = s.entries.find((e) => e.name === CP); const t0 = Math.min(...cp.detail.map((d) => d.at)) - 600000;
  s.entries.push({ exId: pdPlan.id, name: PD, muscle: 'Petto', val: 12, kg: 40, detail: [{ kg: 40, val: 12, at: t0 }, { kg: 40, val: 11, at: t0 + 120000, rpe: 8 }] }); });
const bm = await blob(), sm = bm.logs[mIso].find((x) => x.entries.some((e) => e.name === CP)), ord = sm.entries.map((e) => e.name);
r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: PD, date: [mIso], motivo: 'Unione' });
let b3 = await blob(); const s3 = b3.logs[mIso].find((x) => x.id === sm.id), pds = s3.entries.filter((e) => e.name === PD);
const all = [...sm.entries.find((e) => e.name === PD).detail, ...sm.entries.find((e) => e.name === CP).detail].sort((a, b) => a.at - b.at);
check(!r.err && /unite a quelle già presenti/.test(r.t) && pds.length === 1 && !s3.entries.some((e) => e.name === CP) && s3.entries.length === sm.entries.length - 1, 'unione: una voce sola di Pec deck, nessuna Chest press, nessun doppione');
check(stableStr(pds[0].detail) === stableStr(all) && s3.entries.indexOf(pds[0]) === Math.min(ord.indexOf(CP), ord.indexOf(PD)), 'unione: serie in ordine di ora, voce al posto della prima');
check(pds[0].val === Math.max(...all.filter((d) => !d.w && d.kg === Math.max(...all.filter((x) => !x.w).map((x) => x.kg || 0))).map((d) => d.val)), 'unione: kg e ripetizioni migliori della voce ricalcolati');

// --- 4. esercizio nuovo (con muscolo), poi «tutte le date» verso di lui
r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: NEW, date: [cpDates[4]], muscolo: 'Petto', secondario: 'Tricipiti', motivo: 'Era la inclinata' });
let b4 = await blob(); const ne = entriesOf(b4.logs, NEW);
check(!r.err && /esercizio nuovo/.test(r.t) && ne.length === 1 && ne[0].e.muscle === 'Petto' && ne[0].e.secondary === 'Tricipiti' && /^x/.test(ne[0].e.exId) && ne[0].e.exId !== pdPlan.id, 'esercizio non presente: creato (Petto + Tricipiti, id nuovo)');
const leftCp = withEx(b4.logs, CP);
r = await call('sposta_storico', { esercizio_da: CP, esercizio_a: NEW, motivo: 'Tutte le altre' });
let b5 = await blob();
check(!r.err && leftCp.length > 0 && withEx(b5.logs, CP).length === 0 && leftCp.every((iso) => b5.logs[iso].some((s) => s.entries.some((e) => e.name === NEW && e.exId === ne[0].e.exId))), `date vuote = tutti gli allenamenti: ${leftCp.length} giorni spostati, stesso esercizio (id dallo storico)`);

// --- 5. allenamento che resterebbe vuoto
const eIso = '2026-01-04', eId = 'prova-vuoto';
await appSave((logs) => { logs[eIso] = [{ id: eId, dayKey: 'B', dayName: 'Prova', startedAt: Date.parse(eIso + 'T17:00:00Z'), endedAt: Date.parse(eIso + 'T17:30:00Z'), entries: [{ exId: pdPlan.id, name: PD, muscle: 'Petto', val: 10, kg: 30, detail: [{ kg: 30, val: 10, at: Date.parse(eIso + 'T17:05:00Z') }] }] }]; });
const be = await blob();
r = await call('elimina_storico_esercizio', { esercizio: PD, date: [eIso], motivo: 'x' });
check(r.err && /elimina_allenamento_vuoto/.test(r.t) && (await blob()).rev === be.rev, 'solo un allenamento che resterebbe vuoto, senza flag: niente salvato e lo dice');
const other = withEx(be.logs, PD).find((iso) => iso !== eIso && !mvDates.includes(iso) && iso !== mIso);
r = await call('elimina_storico_esercizio', { esercizio: PD, date: [eIso, other], motivo: 'Due date, una resterebbe vuota' });
let b6 = await blob();
check(!r.err && /Attenzione: L'allenamento del .* ha solo «Pec deck»/.test(r.t) && b6.logs[eIso] && b6.logs[eIso][0].entries.length === 1 && !b6.logs[other].some((s) => s.entries.some((e) => e.name === PD)), 'senza flag: l\'allenamento vuoto resta com\'è (segnalato), l\'altra data sì');
r = await call('elimina_storico_esercizio', { esercizio: PD, date: [eIso], elimina_allenamento_vuoto: true, motivo: 'Allenamento di prova da togliere' });
let b7 = await blob();
check(!r.err && /eliminato l'allenamento del/.test(r.t) && !b7.logs[eIso] && b7.claudeLog.ids.includes(eId), 'con elimina_allenamento_vuoto: allenamento eliminato, nel segno per l\'app');

// --- 6. annulli in ordine (pila): ogni annullo rimette gli allenamenti toccati da quella modifica com'erano prima
// (calcolato qui a parte), senza toccare quello che l'app ha salvato nel frattempo
function revert(cur, before, ids) {
  const out = clone(cur);
  for (const id of ids) {
    for (const iso of Object.keys(out)) { out[iso] = out[iso].filter((x) => String(x.id) !== String(id)); if (!out[iso].length) delete out[iso]; }
    const f = flat(before).find((x) => String(x.s.id) === String(id));
    if (f) { (out[f.iso] = out[f.iso] || []).push(clone(f.s)); out[f.iso].sort((a, b) => a.startedAt - b.startedAt || String(a.id).localeCompare(String(b.id))); }
  }
  return out;
}
const ops = [[b6, b7], [be, b6], [b4, b5], [b3, b4], [bm, b3], [b1, b2], [b0, b1]];   // dalla più recente
let ok = true, msg = '';
for (let k = 0; k < ops.length; k++) {
  const [pre, post] = ops[k], cur = (await blob()).logs, want = revert(cur, pre.logs, post.claudeLog.ids);
  const u = await call('annulla_correzione_storico');
  const now = (await blob()).logs;
  if (u.err || stableStr(now) !== stableStr(want) || !/Fatto/.test(u.t)) { ok = false; msg = `passo ${k + 1}: ${u.t.slice(0, 160)}`; break; }
}
check(ok, 'annulla × 7: ognuno rimette com\'erano gli allenamenti di quella modifica (eliminazioni e allenamento eliminato compresi) ' + msg);
const bEnd = await blob();
const expectEnd = clone(L0); { const s = expectEnd[mIso].find((x) => x.id === sm.id); s.entries.push(clone(sm.entries.find((e) => e.name === PD))); expectEnd[eIso] = clone(be.logs[eIso]); }
check(stableStr(bEnd.logs) === stableStr(expectEnd), 'dopo tutti gli annulli: storico identico all\'inizio, con solo le modifiche fatte dall\'app');
const u8 = await call('annulla_correzione_storico');
check(!u8.err && /Niente da annullare|già/.test(u8.t), 'annullo in più: niente da annullare');

// --- 7. annullo rifiutato se l'app ha cambiato quegli allenamenti; «già annullata» se l'app l'ha rimesso
const bx = await blob(), iso7 = withEx(bx.logs, PD).find((iso) => iso !== eIso);
r = await call('elimina_storico_esercizio', { esercizio: PD, date: [iso7], motivo: 'prova conflitto' });
await appSave((logs) => { const e = logs[iso7][0].entries.find((e) => e.detail && e.detail.length); e.detail[0].val = (e.detail[0].val || 0) + 1; });
const bz = await blob();
const uc = await call('annulla_correzione_storico');
check(uc.err && /cambiato dopo/.test(uc.t) && (await blob()).rev === bz.rev, 'annullo rifiutato: quell\'allenamento è stato cambiato dall\'app dopo (niente salvato)');
await appSave((logs) => { logs[iso7] = clone(bx.logs[iso7]); });   // l'app fa «Rimetti com'era»
const ua = await call('annulla_correzione_storico');
check(!ua.err && /già stata annullata/.test(ua.t) && stableStr((await blob()).logs[iso7]) === stableStr(bx.logs[iso7]), 'annullo dopo «Rimetti com\'era» nell\'app: «era già stata annullata», niente cambiato');

// --- 8. il connettore legge bene i dati dopo tutto (nessun errore nelle letture)
for (const t of ['riepilogo', 'allenamenti', 'volume_muscoli', 'record']) { const x = await call(t, {}); check(!x.err && x.t.length > 50, `lettura «${t}» dopo le modifiche`); }
await c.close();
