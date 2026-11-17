// modifiche alla scheda via MCP: permesso, operazioni, errori atomici, segno "claude", annulla, concorrenza
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
const BASE = 'http://localhost:8888';
const code = fs.readFileSync(process.argv[2], 'utf8').trim();
const key = async (body) => { const r = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); return [r.status, await r.json()]; };
const blob = async () => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
function hsh(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + str.length.toString(36); }
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
await key({ action: 'off' });
const [, on] = await key({ action: 'on' });
check(on.write === false, 'chiave nuova: solo lettura (write=false)');
const c = new Client({ name: 'prova', version: '1.0.0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`)));
const tools = (await c.listTools()).tools;
check(tools.some(t => t.name === 'modifica_scheda') && tools.some(t => t.name === 'annulla_modifica'), 'strumenti di modifica elencati: ' + tools.map(t => t.name + (t.annotations.readOnlyHint ? '' : '*')).join(', '));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args || {} }); return { err: !!r.isError, t: r.content[0].text }; };
const OPS = { motivo: 'Più schiena, panca ferma: prova', modifiche: [
  { azione: 'modifica', giornata: 'Lunedì', esercizio: 'Lat machine', valori: { serie: 4, ripetizioni: '6-10', kg: 55 } },
  { azione: 'aggiungi', giornata: 'Lunedì', dopo: 'Chest press', valori: { nome: 'Panca inclinata con manubri', muscolo: 'Petto', secondario: 'Spalle', serie: 3, ripetizioni: '8-12', recupero: 120 } },
  { azione: 'rimuovi', giornata: 'Mercoledì', esercizio: 'Pec deck' },
  { azione: 'sostituisci', giornata: 'Mercoledì', esercizio: 'Crunch ai cavi', valori: { nome: 'Dead bug', muscolo: 'Addominali' } },
  { azione: 'sposta', giornata: 'Lunedì', esercizio: 'Face pull', posizione: 1 },
  { azione: 'modifica_giornata', giornata: 'Venerdì', nome: 'Venerdì · Calisthenics a casa' },
  { azione: 'aggiungi_giornata', nome: 'Sabato · Gambe leggere' },
  { azione: 'aggiungi', giornata: 'Sabato', valori: { nome: 'Ponte glutei a terra', muscolo: 'Glutei', serie: 3, ripetizioni: '12-15', recupero: 60 } },
  { azione: 'aggiungi', giornata: 'Sabato', valori: { nome: 'Stretching flessori dell\'anca', muscolo: 'Altro', tipo: 'tempo', ripetizioni: '45', serie: 1, recupero: 15, sezione: 'stretching', per_lato: true } },
] };
let r = await call('modifica_scheda', OPS);
check(r.err && /permesso/.test(r.t), 'senza permesso -> rifiutata: ' + r.t.slice(0, 70));
const [, w1] = await key({ action: 'write', on: true });
check(w1.write === true, 'permesso acceso dall\'app');
const [, g1] = await key(); check(g1.write === true && g1.token === on.token, 'GET riporta write=true, stessa chiave');
// errori: niente salvato
const rev0 = (await blob()).rev;
for (const [what, args, rx] of [
  ['muscolo sbagliato', { motivo: 'x', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Lat machine', valori: { muscolo: 'Collo' } }] }, /muscolo/],
  ['esercizio ambiguo', { motivo: 'x', modifiche: [{ azione: 'rimuovi', giornata: 'A', esercizio: 'Superset' }] }, /più esercizi/],
  ['0 serie senza riscaldamento', { motivo: 'x', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Face pull', valori: { serie: 0 } }] }, /serie 0/],
  ['campo sconosciuto', { motivo: 'x', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Face pull', valori: { peso: 3 } }] }, /sconosciuto/],
  ['giornata inesistente', { motivo: 'x', modifiche: [{ azione: 'rimuovi', giornata: 'Domenica', esercizio: 'x' }] }, /nessuna giornata/],
  ['senza motivo', { motivo: ' ', modifiche: [{ azione: 'rimuovi_giornata', giornata: 'A' }] }, /motivo/],
  ['seconda op non valida: anche la prima non si salva', { motivo: 'x', modifiche: [{ azione: 'rimuovi', giornata: 'A', esercizio: 'Face pull' }, { azione: 'aggiungi', giornata: 'A', valori: { nome: 'Senza muscolo' } }] }, /muscolo/],
  ['togliere tutte le giornate normali', { motivo: 'x', modifiche: [{ azione: 'rimuovi_giornata', giornata: 'A' }, { azione: 'rimuovi_giornata', giornata: 'B' }, { azione: 'rimuovi_giornata', giornata: 'C' }] }, /giornata normale/],
  ['azione inventata', { motivo: 'x', modifiche: [{ azione: 'cancella_storico' }] }, /azione/],
]) { const x = await call('modifica_scheda', args); check(x.err && rx.test(x.t), `${what} -> errore: ${x.t.slice(0, 110)}`); }
check((await blob()).rev === rev0, 'dopo gli errori il server è com\'era (rev ' + rev0 + ')');
const before = await blob();
r = await call('modifica_scheda', OPS);
check(!r.err, 'modifica valida salvata');
console.log('\n' + r.t.split('\n').slice(0, 40).join('\n') + '\n');
const after = await blob();
check(after.rev === before.rev + 1, 'rev +1');
check(/^claude-/.test(after.wid), 'wid di Claude: ' + after.wid);
check(after.claude && after.claude.hash === hsh(stableStr(after.days)), 'segno claude con impronta della scheda scritta');
check(after.claude.lines.length === OPS.modifiche.length && after.claude.why === OPS.motivo, 'righe e motivo nel segno');
check(stableStr(after.logs) === stableStr(before.logs) && stableStr(after.settings) === stableStr(before.settings), 'storico e impostazioni intatti');
const A = after.days.A.exercises, idx = n => A.findIndex(e => e.name.startsWith(n));
check(idx('Panca inclinata') === idx('Chest press') + 1, 'aggiunto dopo Chest press');
check(idx('Face pull') === 0 && A[0].phase === 'warm' && /posizione 1, ora in Riscaldamento/.test(after.claude.lines[4]), 'spostato in cima: prende la sezione Riscaldamento (come nell\'app) e lo dice: ' + after.claude.lines[4]);
const lat = A[idx('Lat machine')]; check(lat.sets === 4 && lat.reps === '6-10' && lat.kg === 55, 'Lat machine 4×6-10 55 kg');
check(!after.days.B.exercises.some(e => e.name === 'Pec deck') && after.days.B.exercises.some(e => e.name === 'Dead bug' && e.sets === 3 && e.rest === 75 && e.kg === 0), 'Mercoledì: tolto Pec deck, Crunch -> Dead bug (serie e recupero tenuti)');
const sat = Object.entries(after.days).find(([k, d]) => d.name.startsWith('Sabato'));
check(sat && !['A', 'B', 'C'].includes(sat[0]), 'giornata nuova con lettera libera: ' + (sat && sat[0]));
check(sat[1].exercises[1].phase === 'cool' && sat[1].exercises[1].perSide === true && sat[1].exercises[1].type === 'time', 'stretching per lato in fondo');
// id: lo stesso esercizio in un'altra giornata ha lo stesso id
const lunRev = A[idx('Reverse hyper')], merRev = after.days.B.exercises.find(e => e.name.startsWith('Reverse hyper'));
check(lunRev.id === merRev.id, 'stesso esercizio in due giornate: stesso id');
// letture dopo la modifica
r = await call('scheda'); check(/\[giornata A\]/.test(r.t) && /^1\. /m.test(r.t) && /Panca inclinata con manubri/.test(r.t), 'scheda riletta: lettere, posizioni, esercizio nuovo');
check(/Ultima modifica di Claude: .*«Più schiena, panca ferma: prova»/.test(r.t), 'scheda: ultima modifica di Claude con il motivo');
// annulla
r = await call('annulla_modifica'); check(!r.err && /tornata/.test(r.t), 'annulla_modifica: ' + r.t.slice(0, 80));
const undone = await blob();
check(hsh(stableStr(undone.days)) === hsh(stableStr(before.days)), 'scheda tornata identica a prima');
check(undone.claude && undone.claude.undo === true, 'segno claude di annullamento');
r = await call('annulla_modifica'); check(/Niente da annullare/.test(r.t), 'secondo annulla: niente da annullare');
// annulla rifiutato se la scheda è cambiata dopo (dall'app)
r = await call('modifica_scheda', { motivo: 'prova', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Face pull', valori: { recupero: 60 } }] });
const b2 = await blob();
const days2 = JSON.parse(JSON.stringify(b2.days)); days2.A.exercises[0].rest = 33;
const post = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: b2.rev, logs: b2.logs, days: days2, daysAt: Date.now(), settings: b2.settings, setAt: b2.setAt, wid: 'app-x' }) });
check(post.ok, 'l\'app salva una sua modifica');
const b3 = await blob(); check(b3.claude && b3.claude.hash === b2.claude.hash, 'sync.mjs conserva il segno claude');
r = await call('annulla_modifica'); check(r.err && /cambiata/.test(r.t), 'annulla dopo una modifica dall\'app -> rifiutato');
// due modifiche nello stesso istante: tutte e due salvate (scrittura condizionata, si riprova)
const [x1, x2] = await Promise.all([
  call('modifica_scheda', { motivo: 'uno', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Lat machine', valori: { recupero: 101 } }] }),
  call('modifica_scheda', { motivo: 'due', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Alzate laterali', valori: { recupero: 102 } }] })]);
const b4 = await blob(), A4 = b4.days.A.exercises;
check(!x1.err && !x2.err && A4.find(e => e.name.startsWith('Lat machine')).rest === 101 && A4.find(e => e.name.startsWith('Alzate laterali')).rest === 102 && b4.rev === b3.rev + 2, 'due modifiche insieme: entrambe salvate, rev +2');
{ const x = await call('modifica_scheda', { motivo: 'testo JSON', modifiche: JSON.stringify([{ azione: 'modifica', giornata: 'A', esercizio: 'Barchetta', valori: JSON.stringify({ ripetizioni: '12' }) }]) });
  check(!x.err && /ripetizioni 10 → 12/.test(x.t), 'modifiche mandate come testo JSON: accettate'); await call('annulla_modifica'); }
// permesso spento: rifiuta subito
await key({ action: 'write', on: false });
r = await call('modifica_scheda', { motivo: 'x', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Lat machine', valori: { serie: 5 } }] });
check(r.err && /permesso/.test(r.t), 'permesso spento -> rifiutata');
r = await call('riepilogo'); check(!r.err, 'le letture funzionano ancora');
// nuova chiave: tiene il permesso
await key({ action: 'write', on: true });
const [, nw] = await key({ action: 'new' }); check(nw.write === true && nw.token !== on.token, 'Nuova chiave: tiene il permesso di modificare');
const [, wbad] = await key({ action: 'write', on: 'si' }); check(wbad.error, 'write con valore non booleano -> errore');
await c.close();
// la vecchia chiave non scrive più
try { const c2 = new Client({ name: 'p', version: '1' }); await c2.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${on.token}`))); check(false, 'vecchia chiave collegata!'); } catch (e) { check(true, 'vecchia chiave rifiutata'); }
// lascio per i test dell'app: chiave nuova, permesso acceso, scheda come prima della prova di concorrenza
fs.writeFileSync(process.argv[2] + '.token', nw.token);
