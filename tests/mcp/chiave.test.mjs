// connettore per Claude: chiave creata dall'app, strumenti di lettura, chiave nell'indirizzo o nell'intestazione,
// chiavi sbagliate, Nuova chiave (la vecchia non vale più), Disattiva
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
const BASE = 'http://localhost:8888';
const code = fs.readFileSync(process.argv[2], 'utf8').trim();
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const key = async (method, action) => { const r = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=mcp`, method === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }); return [r.status, await r.json()]; };
async function connect(url, headers) {
  const client = new Client({ name: 'prova', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), headers ? { requestInit: { headers } } : undefined);
  await client.connect(transport);
  return client;
}
const refused = async (url, h) => { try { const c = await connect(url, h); await c.close(); return false; } catch (e) { return true; } };

const [st0, s0] = await key('GET');
check(st0 === 200 && !s0.token, 'all\'inizio nessuna chiave');
const [, on] = await key('POST', 'on');
check(typeof on.token === 'string' && on.token.length >= 20, 'chiave creata');
const [, on2] = await key('POST', 'on');
check(on2.token === on.token, 'accendere di nuovo dà la stessa chiave');
const token = on.token;

// 1. chiave nell'indirizzo
const c = await connect(`${BASE}/mcp/${token}`);
check(/palestra/i.test(JSON.stringify(c.getServerVersion())), 'server collegato');
check(/riepilogo/.test(c.getInstructions() || ''), 'istruzioni per Claude');
const { tools } = await c.listTools();
const names = tools.map(t => t.name);
check(['riepilogo', 'scheda', 'allenamenti', 'storico_esercizio', 'volume_muscoli', 'record'].every(n => names.includes(n)), 'strumenti di lettura elencati: ' + names.join(', '));
check(tools.filter(t => ['riepilogo', 'scheda', 'allenamenti', 'storico_esercizio', 'volume_muscoli', 'record'].includes(t.name)).every(t => t.annotations && t.annotations.readOnlyHint), 'strumenti di lettura segnati «sola lettura»');
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { err: !!r.isError, t: r.content[0].text }; };
const rie = await call('riepilogo', {});
check(!rie.err && rie.t.length > 200, 'riepilogo');
check(/ginocchio/.test(rie.t), 'riepilogo con le note per Claude');
const sch = await call('scheda', {});
check(!sch.err && /Lat machine/i.test(sch.t), 'scheda con gli esercizi');
const all = await call('allenamenti', { limite: 2 });
check(!all.err && (all.t.match(/^##/gm) || []).length === 2, 'allenamenti: limite 2 rispettato');
const sto = await call('storico_esercizio', { esercizio: 'lat machine', limite: 3 });
check(!sto.err && /×/.test(sto.t), 'storico di un esercizio (nome scritto in minuscolo)');
const vol = await call('volume_muscoli', { settimane: 2 });
check(!vol.err && /Dorso|Petto|Gambe|Quadricipiti/i.test(vol.t), 'serie per muscolo');
const rec = await call('record', { limite: 5 });
check(!rec.err && /kg/i.test(rec.t), 'record');
const none = await call('storico_esercizio', { esercizio: 'zzz' });
check(/non trov|nessun/i.test(none.t), 'esercizio inesistente: lo dice');
let unknown = false;
try { const r = await c.callTool({ name: 'cancella_tutto', arguments: {} }); unknown = !!r.isError; } catch (e) { unknown = true; }
check(unknown, 'strumento inesistente rifiutato');
await c.close();

// 2. chiave nell'intestazione
const c2 = await connect(`${BASE}/mcp`, { Authorization: 'Bearer ' + token });
check((await c2.listTools()).tools.length === tools.length, 'chiave nell\'intestazione Authorization');
await c2.close();

// 3. chiavi sbagliate o revocate
check(await refused(`${BASE}/mcp`), 'senza chiave: rifiutato');
check(await refused(`${BASE}/mcp/AAAAAAAAAAAAAAAAAAAAAAAAAA`), 'chiave inventata: rifiutata');
check(await refused(`${BASE}/mcp/${code.replace(/-/g, '')}`), 'codice di sincronizzazione al posto della chiave: rifiutato');
const [, nw] = await key('POST', 'new');
check(nw.token && nw.token !== token, 'Nuova chiave: diversa');
check(await refused(`${BASE}/mcp/${token}`), 'la vecchia chiave non vale più');
const c3 = await connect(`${BASE}/mcp/${nw.token}`); check((await c3.listTools()).tools.length > 0, 'la nuova chiave funziona'); await c3.close();
const [, off] = await key('POST', 'off');
check(!off.token, 'Disattiva');
check(await refused(`${BASE}/mcp/${nw.token}`), 'dopo Disattiva la chiave è rifiutata');
const r = await fetch(`${BASE}/api/sync?code=ZZZZZZZZZZZZZZZZZZZZ&op=mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"on"}' });
const j = await r.json().catch(() => ({}));
check(!j.token, 'nessuna chiave per un codice senza dati');
