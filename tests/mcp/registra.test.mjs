// registra_allenamento (connettore, Node + server di prova con le funzioni vere): permesso, input non validi (niente
// salvato), forma salvata come quella dell'app (compatta), esercizi riconosciuti come nell'app (scheda, nuovo con
// muscolo), ora italiana d'estate e d'inverno, riserva con «vale_come», allenamento libero con durata stimata, richiesta
// ripetuta senza doppioni, letture che lo contano, annullo in pila e rifiuti
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
const BASE = 'http://localhost:8888';
const code = fs.readFileSync(process.argv[2], 'utf8').trim();
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const clone = (v) => JSON.parse(JSON.stringify(v));
const blob = async () => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
const key = async (body) => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
async function appSave(mut) {
  const b = await blob(); const logs = clone(b.logs); mut(logs);
  const r = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: b.rev, logs, days: b.days, daysAt: b.daysAt, settings: b.settings, setAt: b.setAt, wid: 'app-prova' }) });
  return r.ok;
}
const rome = (ts, o) => new Intl.DateTimeFormat(o === 'iso' ? 'en-CA' : 'it-IT', o === 'iso' ? { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' } : { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const flat = (logs) => Object.keys(logs).sort().flatMap((iso) => logs[iso].map((s) => ({ iso, s })));

await key({ action: 'off' });
const on = await key({ action: 'on' });
const c = new Client({ name: 'prova', version: '1.0.0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text }; };
const tools = (await c.listTools()).tools, tR = tools.find((t) => t.name === 'registra_allenamento');
check(tR && tR.annotations.readOnlyHint === false && tR.annotations.destructiveHint === false && tR.inputSchema.required.includes('motivo') && /annulla_correzione_storico/.test(tR.description), 'registra_allenamento elencato: scrive, non distrugge, motivo obbligatorio');
check(/registra_allenamento/.test(c.getInstructions()) && /registrati/.test(tools.find((t) => t.name === 'annulla_correzione_storico').description), 'istruzioni e descrizione dell\'annullo aggiornate');

const b0 = await blob(), L0 = clone(b0.logs), today = rome(Date.now(), 'iso');
const A = b0.days.A, planEx = A.exercises.find((e) => e.muscle && e.muscle !== 'Altro' && e.sets > 0 && (!e.type || e.type === 'reps'));
const spare = Object.keys(b0.days).find((k) => b0.days[k].spare);
// un giorno passato senza allenamenti
let free = addDays(today, -1); while (L0[free]) free = addDays(free, -1);
const ex = (o) => Object.assign({ nome: planEx.name, serie: [{ kg: 20, ripetizioni: 10 }] }, o);
const base = { data: free, ora: '07:30', durata: 50, giornata: 'A', motivo: 'Allenamento non segnato (telefono scarico)', esercizi: [ex()] };

// --- permesso spento
let r = await call('registra_allenamento', base);
check(r.err && /correggere lo storico/.test(r.t) && (await blob()).rev === b0.rev, 'permesso spento: errore chiaro, niente salvato');
await key({ action: 'writeLogs', on: true });

// --- input non validi: errore che dice cosa, nessuna modifica
const tomorrow = addDays(today, 1), y = +today.slice(0, 4);
const marchDst = (() => { for (let d = 31; d > 24; d--) { const iso = `${y}-03-${d}`; if (new Date(iso + 'T12:00:00Z').getUTCDay() === 0) return iso; } })();
const bads = [
  ['senza motivo', { ...base, motivo: '' }, /motivo/],
  ['data nel futuro', { ...base, data: tomorrow }, /non è ancora arrivato/],
  ['data impossibile', { ...base, data: '2026-02-30' }, /AAAA-MM-GG/],
  ['oggi a un\'ora che non è ancora arrivata', { ...base, data: today, ora: '23:59' }, /non è ancora arrivato|ora/],
  ['ora scritta male', { ...base, ora: '25:00' }, /HH:MM/],
  ['ora che non esiste (cambio dell\'ora legale)', { ...base, data: marchDst <= today ? marchDst : `${y - 1}-03-29`, ora: '02:30' }, /non esiste/],
  ['durata fuori misura', { ...base, durata: 0 }, /durata/],
  ['giornata sconosciuta', { ...base, giornata: 'Z9' }, /nessuna giornata/],
  ['vale_come su una giornata normale', { ...base, vale_come: 'B' }, /solo per una giornata di riserva/],
  ['senza esercizi', { ...base, esercizi: [] }, /esercizi/],
  ['esercizio nuovo senza muscolo', { ...base, esercizi: [ex({ nome: 'Panca stramba nuova' })] }, /indica «muscolo»/],
  ['muscolo diverso da quello in scheda', { ...base, esercizi: [ex({ muscolo: planEx.muscle === 'Schiena' ? 'Petto' : 'Schiena' })] }, /già/],
  ['tipo diverso da quello in scheda', { ...base, esercizi: [ex({ tipo: 'tempo' })] }, /non a tempo/],
  ['stesso esercizio due volte', { ...base, esercizi: [ex(), ex({ nome: '  ' + planEx.name.toUpperCase() + ' ' })] }, /due volte/],
  ['esercizio senza serie', { ...base, esercizi: [ex({ serie: [] })] }, /serie/],
  ['serie senza ripetizioni', { ...base, esercizi: [ex({ serie: [{ kg: 20 }] })] }, /ripetizioni/],
  ['kg fuori misura', { ...base, esercizi: [ex({ serie: [{ kg: 5000, ripetizioni: 10 }] })] }, /kg/],
  ['tipo di serie sconosciuto', { ...base, esercizi: [ex({ serie: [{ kg: 20, ripetizioni: 10, tipo: 'superserie' }] })] }, /sconosciuto/],
  ['nota troppo lunga', { ...base, nota: 'x'.repeat(1200) }, /nota/],
];
for (const [what, args, rx] of bads) {
  const x = await call('registra_allenamento', args); const b = await blob();
  check(x.err && /Nessun allenamento registrato/.test(x.t) && rx.test(x.t) && b.rev === b0.rev, `${what}: rifiutato, niente salvato — ${x.t.slice(0, 100)}`);
}

// --- 1. giornata A, con un esercizio della scheda (nome scritto diverso) e uno nuovo; riscaldamento, cedimento, RPE, nota
const pd0 = (await call('storico_esercizio', { esercizio: planEx.name, limite: 100 })).t;
const sum0 = (await call('riepilogo')).t;
r = await call('registra_allenamento', { ...base, nota: 'Recuperato da Claude', esercizi: [
  ex({ nome: '  ' + planEx.name.toUpperCase() + '  ', serie: [{ kg: 10, ripetizioni: 12, tipo: 'riscaldamento' }, { kg: 22.5, ripetizioni: 10, rpe: 8 }, { kg: 22.5, ripetizioni: 9, tipo: 'cedimento', rpe: 10 }] }),
  { nome: 'Croci su panca inclinata (prova)', muscolo: 'Petto', secondario: 'Spalle', serie: [{ kg: 8, ripetizioni: 12 }, { kg: 8, ripetizioni: 11 }] },
  { nome: 'Plank di prova', muscolo: 'Addominali', tipo: 'tempo', serie: [{ ripetizioni: 45 }, { ripetizioni: 40 }] }] });
let b1 = await blob();
const s1 = (b1.logs[free] || [])[0];
check(!r.err && s1 && r.t.includes(`registrato l'allenamento del ${dmy(free)} delle 07:30`) && /3 esercizi, 7 serie/.test(r.t), 'registrato: ' + r.t.split('\n')[0]);
check(s1 && rome(s1.startedAt, 'iso') === free && rome(s1.startedAt) === '07:30' && s1.endedAt - s1.startedAt === 50 * 60000 && s1.dayKey === 'A' && s1.dayName === A.name && s1.note === 'Recuperato da Claude' && !('forDay' in s1), 'salvato con data, ora italiana, durata, giornata e nota giuste');
const [e1, e2, e3] = s1 ? s1.entries : [];
check(e1 && e1.exId === planEx.id && e1.name === planEx.name && e1.muscle === planEx.muscle && e1.kg === 22.5 && e1.val === 10 && e1.tonnage === 10 * 12 + 22.5 * 10 + 22.5 * 9 && !('sets' in e1)
  && JSON.stringify(e1.detail) === JSON.stringify([{ kg: 10, val: 12, w: true }, { kg: 22.5, val: 10, rpe: 8 }, { kg: 22.5, val: 9, rpe: 10, t: 'f' }]), 'esercizio della scheda: stesso id e nome della scheda, serie in forma compatta (R, F, RPE), peso e totale come l\'app');
check(e2 && e2.exId && e2.exId !== planEx.id && e2.muscle === 'Petto' && e2.secondary === 'Spalle' && !('type' in e2) && !('tonnage' in e2) && e3 && e3.type === 'time' && JSON.stringify(e3.detail) === '[{"val":45},{"val":40}]' && !('kg' in e3), 'esercizi nuovi: muscoli e tipo dati, niente «kg»: 0 né campi vuoti');
check(/Esercizi nuovi .*Croci su panca inclinata \(prova\) \(Petto \+ Spalle\)/.test(r.t) && /La scheda non cambia/.test(r.t) && JSON.stringify(b1.days) === JSON.stringify(b0.days), 'la risposta dice quali esercizi sono nuovi; la scheda non cambia');
check(b1.claudeLog && b1.claudeLog.ids.includes(s1.id) && /Allenamento non segnato/.test(b1.claudeLog.why) && /registrato l'allenamento/.test(b1.claudeLog.lines[0]) && b1.claudeLog.lines.length === 1 && b1.claudeLog.lines[0].includes(planEx.name + ': R 10×12, 22,5×10 @8, F 22,5×9 @10'), 'segno per l\'app: motivo, una riga sola (un allenamento = una correzione) con le serie, id dell\'allenamento');
const pd1 = (await call('storico_esercizio', { esercizio: planEx.name, limite: 100 })).t, sum1 = (await call('riepilogo')).t;
const nS = (t) => +((/· (\d+) sedute/.exec(t) || [])[1] || 0), nTot = (t) => +((/Totale: (\d+) allenamenti/.exec(t) || [])[1] || 0);
check(nS(pd1) === nS(pd0) + 1 && pd1.includes(dmy(free)) && nTot(sum1) === nTot(sum0) + 1, `letture: ${planEx.name} ${nS(pd0)} → ${nS(pd1)} sedute, totale ${nTot(sum0)} → ${nTot(sum1)}`);

// --- 2. richiesta ripetuta (il client riprova): nessun doppione
const again = await call('registra_allenamento', { ...base, nota: 'Recuperato da Claude', esercizi: [ex({ nome: planEx.name }), { nome: 'Croci su panca inclinata (prova)', serie: [{ kg: 8, ripetizioni: 12 }] }, { nome: 'Plank di prova', serie: [{ ripetizioni: 45 }] }] });
check(again.err && /sembra già registrato/.test(again.t) && (await blob()).rev === b1.rev, 'richiesta ripetuta: rifiutata, nessun doppione');

// --- 3. ora d'estate e d'inverno; riserva con «vale_come»
const summer = `${today >= `${y}-07-15` ? y : y - 1}-07-15`, winter = `${today >= `${y}-01-15` ? y : y - 1}-01-15`;
for (const [iso, what] of [[summer, 'estate'], [winter, 'inverno']]) {
  r = await call('registra_allenamento', { ...base, data: iso, ora: '19:05', giornata: spare, vale_come: 'A', esercizi: [ex()] });
  const s = (await blob()).logs[iso].find((x) => x.entries.some((e) => e.name === planEx.name) && rome(x.startedAt) === '19:05');
  check(!r.err && s && rome(s.startedAt, 'iso') === iso && s.dayKey === spare && s.forDay === 'A' && /vale come/.test(r.t), `${what} (${dmy(iso)}): ore 19:05 italiane salvate giuste, riserva che vale come A`);
}

// --- 4. allenamento libero: senza giornata, ora e durata (stimate e dette)
let free2 = addDays(free, -1); while (L0[free2]) free2 = addDays(free2, -1);
r = await call('registra_allenamento', { data: free2, motivo: 'Corsa al parco', esercizi: [{ nome: 'Corsa di prova', muscolo: 'Altro', tipo: 'distanza', serie: [{ ripetizioni: 3000 }] }] });
const s4 = (await blob()).logs[free2].find((x) => x.dayKey === 'free');
check(!r.err && s4 && s4.dayName === 'Allenamento libero' && rome(s4.startedAt) === '18:00' && /Ora non indicata/.test(r.t) && /Durata non indicata: stimata/.test(r.t) && s4.entries[0].type === 'dist' && !('muscle' in s4.entries[0]), 'allenamento libero: 18:00 e durata stimata (detti nella risposta), distanza, muscolo Altro non scritto');

// --- 5. annulli in pila: l'ultimo (libero), poi rifiuto se l'app l'ha cambiato, poi «già annullata» se l'app l'ha tolto
r = await call('annulla_correzione_storico');
let b5 = await blob();
check(!r.err && /Fatto/.test(r.t) && !(b5.logs[free2] || []).some((x) => x.id === s4.id) && /ancora 3 modifiche/.test(r.t), 'annulla: tolto l\'allenamento libero registrato (ne restano 3)');
check(b5.claudeLog && b5.claudeLog.undo === true && b5.claudeLog.ids.includes(s4.id), 'segno per l\'app: annullo con l\'id dell\'allenamento tolto');
const sW = b5.logs[winter].find((x) => x.entries.some((e) => e.name === planEx.name) && rome(x.startedAt) === '19:05');
await appSave((logs) => { logs[winter].find((x) => x.id === sW.id).note = 'cambiata nell\'app'; });
r = await call('annulla_correzione_storico');
check(r.err && /cambiato dopo/.test(r.t) && (await blob()).logs[winter].some((x) => x.id === sW.id), 'annulla rifiutato: l\'app ha cambiato l\'allenamento registrato, resta');
await appSave((logs) => { logs[winter] = logs[winter].filter((x) => x.id !== sW.id); if (!logs[winter].length) delete logs[winter]; });
r = await call('annulla_correzione_storico');
check(!r.err && /già stata annullata/.test(r.t), 'tolto dall\'app: «era già stata annullata», si passa alla precedente');
r = await call('annulla_correzione_storico'); r = await call('annulla_correzione_storico');
const b6 = await blob();
check(!r.err && !(b6.logs[free] || []).some((x) => x.id === s1.id) && !(b6.logs[summer] || []).some((x) => rome(x.startedAt) === '19:05' && x.dayKey === spare), 'annullate anche le altre due: lo storico non ha più gli allenamenti registrati');
const keep = (logs) => JSON.stringify(flat(logs).map(({ iso, s }) => [iso, s.id, s.entries.length]));
check(keep(b6.logs) === keep(L0), 'storico tornato come all\'inizio');
r = await call('annulla_correzione_storico');
check(!r.err && /Niente da annullare/.test(r.t), 'pila vuota: niente da annullare');
