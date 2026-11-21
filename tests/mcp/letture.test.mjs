// letture nuove del connettore (Node + server di prova con le funzioni vere): confronta_periodi (totali uguali a quelli
// ricalcolati dai dati), analisi_scheda (serie fatte = media di volume_muscoli), progressione_suggerita, cerca_note
// (maiuscole e accenti, impostazioni), esporta (stesse righe dei dati, niente celle-formula), formato compatto, errori
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
  const b = await blob(); const logs = clone(b.logs); mut(logs, b);
  const r = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: b.rev, logs, days: b.days, daysAt: b.daysAt, settings: b.settings, setAt: b.setAt, wid: 'app-prova' }) });
  return r.ok;
}
const romeIso = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fnum = (n) => { n = Math.round(n * 10) / 10; return Number.isInteger(n) ? String(n) : String(n).replace('.', ','); };
const flat = (logs) => Object.keys(logs).sort().flatMap((iso) => logs[iso].map((s) => ({ iso, s })));
const workSets = (s) => s.entries.reduce((a, e) => a + (e.muscle && e.muscle !== 'Altro' ? e.detail.filter((d) => !d.w).length : 0), 0);

await key({ action: 'off' });
const on = await key({ action: 'on' });
const c = new Client({ name: 'prova', version: '1.0.0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
// ogni risposta anche in un file (tests/.out/mcp-letture/), per rileggerle
let nOut = 0;
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); const t = r.content[0].text;
  if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}/${String(++nOut).padStart(2, '0')}-${name}.txt`, JSON.stringify(args || {}) + '\n\n' + t);
  return { err: !!r.isError, t }; };
const tools = (await c.listTools()).tools, names = tools.map((t) => t.name);
const NEW = ['confronta_periodi', 'analisi_scheda', 'progressione_suggerita', 'cerca_note', 'esporta'];
check(NEW.every((n) => names.includes(n)) && NEW.every((n) => tools.find((t) => t.name === n).annotations.readOnlyHint === true), 'strumenti nuovi elencati, di sola lettura: ' + NEW.join(', '));
check(NEW.every((n) => c.getInstructions().includes(n)), 'istruzioni del server con gli strumenti nuovi');
const tW = tools.find((t) => t.name === 'allenamenti');
check(tW.inputSchema.properties.formato && tW.inputSchema.properties.formato.enum.includes('compatto'), 'allenamenti: parametro formato (compatto)');

// note di prova (anche una nota con accenti e maiuscole) e un esercizio col nome che sembra una formula
const b0 = await blob();
const today = romeIso(Date.now());
let noteIso = null;
await appSave((logs) => {
  const L = flat(logs).filter((x) => x.iso < today);
  const x = L[L.length - 3]; noteIso = x.iso;
  x.s.note = 'Fastidio alla SPALLA destra durante la panca; più leggero la prossima volta';
  const y = L[L.length - 6]; y.s.entries.push({ name: '=HYPERLINK("http://x")', muscle: 'Petto', val: 10, detail: [{ kg: 20, val: 10 }, { kg: 20, val: 9 }] });
});
const b = await blob(), F = flat(b.logs);
check(b.rev > b0.rev, 'dati di prova salvati come dall\'app');

// --- confronta_periodi: predefinito 28 + 28 giorni; numeri uguali a quelli ricalcolati dai dati
let r = await call('confronta_periodi', {});
const bFrom = addDays(today, -27), aTo = addDays(bFrom, -1), aFrom = addDays(aTo, -27);
const inR = (f, t) => F.filter((x) => x.iso >= f && x.iso <= t);
const nA = inR(aFrom, aTo).length, nB = inR(bFrom, today).length;
const sA = inR(aFrom, aTo).reduce((a, x) => a + workSets(x.s), 0), sB = inR(bFrom, today).reduce((a, x) => a + workSets(x.s), 0);
check(!r.err && r.t.includes(`- Allenamenti: A ${nA} → B ${nB}`) && r.t.includes(`- Serie di lavoro: A ${sA} → B ${sB}`), `confronta_periodi: allenamenti ${nA} → ${nB} e serie ${sA} → ${sB} uguali ai dati`);
check(/## Serie per muscolo a settimana/.test(r.t) && /## Esercizi fatti in tutti e due i periodi: \d+/.test(r.t) && /## Record battuti in B: \d+/.test(r.t), 'confronta_periodi: muscoli, esercizi e record');
const ex1 = /\n- ([^:\n]+): ([\d,]+) → ([\d,]+) kg \(([+−±])/.exec(r.t);
check(!!ex1, 'confronta_periodi: massimale stimato prima → dopo per un esercizio (' + (ex1 ? ex1[0].trim() : 'nessuno') + ')');
r = await call('confronta_periodi', { a_dal: aFrom, a_al: aTo, b_dal: bFrom, b_al: today });
check(!r.err && r.t.includes(`- Allenamenti: A ${nA} → B ${nB}`), 'confronta_periodi con le date esplicite: stessi numeri');
r = await call('confronta_periodi', { b_dal: '2026-02-30' });
check(r.err && /non è una data valida/.test(r.t), 'data impossibile: errore chiaro');
r = await call('confronta_periodi', { b_dal: today, b_al: addDays(today, -3) });
check(r.err && /finisce prima di cominciare/.test(r.t), 'periodo al contrario: errore chiaro');

// --- analisi_scheda: «fatte» = media delle settimane complete di volume_muscoli
r = await call('analisi_scheda', { settimane: 3 });
const v = await call('volume_muscoli', { settimane: 4 });
const media = /## Media delle 3 settimane complete\n([^\n]+)/.exec(v.t);
const avg = media ? Object.fromEntries(media[1].split(' · ').map((x) => { const m = /^(\S+) ([\d,]+)$/.exec(x); return m ? [m[1], m[2]] : [x, '']; })) : {};
const done = Object.fromEntries([...r.t.matchAll(/\n- (\S+): [\d,]+ → ([\d,]+) · obiettivo/g)].map((m) => [m[1], m[2]]));
const ks = Object.keys(avg).filter((m) => done[m] !== undefined);
check(!r.err && ks.length >= 8 && ks.every((m) => done[m] === avg[m]), `analisi_scheda: serie fatte = media di volume_muscoli (${ks.map((m) => m + ' ' + done[m] + (done[m] !== avg[m] ? '≠' + avg[m] : '')).join(', ')})`);
check(/## Costanza\n[\d,]+ allenamenti a settimana; la scheda ha \d+ giornate/.test(r.t) && /Pronti ad aumentare/.test(r.t) && /## Giornate\n- /.test(r.t) && /durata media/.test(r.t), 'analisi_scheda: costanza, esercizi della scheda, giornate con durata media');
check(/Fatti nel periodo ma non in scheda: .*=HYPERLINK/.test(r.t) || !inR(addDays(today, -27), today).some((x) => x.s.entries.some((e) => e.name.startsWith('=HYPERLINK'))), 'analisi_scheda: esercizi fuori scheda');

// --- progressione_suggerita
r = await call('progressione_suggerita', { giornata: 'A' });
const lines = r.t.split('\n').filter((l) => /^- /.test(l));
const nA_ = Object.values(b.days.A ? { A: b.days.A } : {}).flatMap((d) => d.exercises).filter((e) => e.muscle && e.muscle !== 'Altro' && e.sets > 0).length;
check(!r.err && lines.length === nA_ && /\[giornata A\]/.test(r.t) && (r.t.match(/^## /gm) || []).length === 1 && lines.every((l) => /: (AUMENTA|SCALA|FERMO|CONTINUA) — |: nessun consiglio — |: mai fatto — |: vedi sopra/.test(l)), `progressione_suggerita giornata A: ${lines.length} esercizi, ognuno con un consiglio o il perché no`);
check(/kg/.test(r.t) && /\d\d\/\d\d: /.test(r.t), 'progressione_suggerita: data e carichi dell\'ultima volta (' + (lines[0] || '').slice(0, 120) + ')');
r = await call('progressione_suggerita', { esercizio: 'esercizio inesistente' });
check(r.err && /non è nella scheda/.test(r.t), 'progressione_suggerita: esercizio fuori scheda, errore chiaro');
r = await call('progressione_suggerita', { giornata: 'Z9' });
check(r.err && /Nessuna giornata/.test(r.t), 'progressione_suggerita: giornata sconosciuta, errore con l\'elenco');

// --- cerca_note
const stanco = F.filter((x) => /stanco/i.test(x.s.note || '')).length;
r = await call('cerca_note', { testo: 'STANCO' });
check(!r.err && r.t.includes(`: ${stanco}`) && (r.t.match(/\nNota: /g) || []).length === Math.min(30, stanco), `cerca_note «STANCO»: ${stanco} note (maiuscole ignorate)`);
r = await call('cerca_note', { testo: 'spalla panca' });
check(!r.err && /: 1\b/.test(r.t.split('\n')[0]) && r.t.includes('Fastidio alla SPALLA') && r.t.includes(noteIso.slice(8, 10) + '/' + noteIso.slice(5, 7)) && /Esercizi: /.test(r.t), 'cerca_note «spalla panca»: la nota giusta, con data ed esercizi');
r = await call('cerca_note', { testo: 'più leggèro' });
check(!r.err && r.t.includes('Fastidio alla SPALLA'), 'cerca_note: accenti ignorati');
r = await call('cerca_note', { testo: 'ginocchio' });
check(!r.err && /Da sapere su di me \(impostazioni\): .*ginocchio/.test(r.t), 'cerca_note: trova anche le «cose da sapere» delle impostazioni');
r = await call('cerca_note', { testo: 'parolachenonce' });
check(!r.err && /Nessuna nota corrisponde \(note in tutto lo storico: \d+\)/.test(r.t), 'cerca_note: nessun risultato, lo dice');

// --- esporta: una riga per serie, stesse colonne dell'app, niente celle-formula
r = await call('esporta', {});
const csvOf = (t) => (/```csv\n([\s\S]*?)\n```/.exec(t) || [])[1] || '';
let csv = csvOf(r.t);
// troppo lungo: si ferma a un giorno intero e dice da dove ripartire; la seconda parte continua senza doppioni
const cutM = /dal = (\d{4}-\d{2}-\d{2})/.exec(r.t);
if (cutM) {
  const r2 = await call('esporta', { dal: cutM[1] }), c2 = csvOf(r2.t).split('\n');
  const lastDay = csv.split('\n').pop().split(';')[0];
  check(r.t.length <= 60000 && /Tagliato per lunghezza/.test(r.t) && lastDay < cutM[1] && c2[1].startsWith(cutM[1]), `esporta lunga: tagliata a giorni interi (fino al ${lastDay}), si riparte dal ${cutM[1]}`);
  csv += '\n' + c2.slice(1).join('\n');
}
const rows = csv.split('\n'), sets = F.reduce((a, x) => a + x.s.entries.reduce((y, e) => y + e.detail.length, 0), 0);
check(!r.err && rows[0] === 'data;ora;giornata;esercizio;muscolo;secondario;tipo;serie_n;kg;valore;unita;rpe;tonnellaggio_serie;riscaldamento;tipo_serie;per_lato', 'esporta: intestazione come «Esporta → CSV» dell\'app');
check(rows.length - 1 === sets, `esporta: ${rows.length - 1} righe = ${sets} serie nei dati`);
const formula = rows.slice(1).flatMap((l) => l.split(';')).filter((x) => /^"?[=+@]/.test(x) || /^"?-[^\d]/.test(x));
check(!formula.length && csv.includes("'=HYPERLINK"), 'esporta: il nome che sembra una formula resta testo (\'=HYPERLINK…)');
check(rows.slice(1).every((l) => l.split(';').length >= 16) && rows.some((l) => /;R;/.test(l)) && rows.some((l) => /\d,\d/.test(l)), 'esporta: 16 colonne, riscaldamenti «R», virgola decimale');
r = await call('esporta', { esercizio: 'hyperlink' });
check(!r.err && (/```csv\n([\s\S]*?)\n```/.exec(r.t) || [])[1].split('\n').length === 3, 'esporta con «esercizio»: solo le sue serie');
r = await call('esporta', { dal: '2026-13-01' });
check(r.err && /non è una data valida/.test(r.t), 'esporta: data sbagliata, errore');

// --- formato compatto
const full = await call('allenamenti', { limite: 10 }), comp = await call('allenamenti', { limite: 10, formato: 'compatto' });
check(!comp.err && comp.t.length < full.t.length * 0.7 && /\d×\d+\/\d+/.test(comp.t) && !/\[Petto/.test(comp.t) && !/ @\d/.test(comp.t) && !/: R /.test(comp.t) && /Formato compatto/.test(comp.t) && /\[Petto/.test(full.t), `formato compatto: ${comp.t.length} caratteri contro ${full.t.length}, serie con lo stesso peso unite (60×10/9/8), niente muscoli, RPE e riscaldamenti`);
const def = await call('allenamenti', {});
check(def.t === full.t, 'allenamenti senza formato: uguale a prima (completo)');
