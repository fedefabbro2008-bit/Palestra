// Funzioni del sito: dati, connettore per Claude, Telegram (webhook e bot orario).
// Si lancia con:  node --import ./test/registra-finto.mjs --test test/server.test.mjs   (dalla cartella giardino-netlify)
import { test } from "node:test";
import assert from "node:assert/strict";
import { inviati, OGGI } from "./rete-finta.mjs";
import { getStore } from "@netlify/blobs";
import { gunzipSync } from "node:zlib";
import * as M from "../netlify/lib/modello.mjs";
const dati = (await import("../netlify/functions/dati.mjs")).default;
const mcp = (await import("../netlify/functions/mcp.mjs")).default;
const telegram = (await import("../netlify/functions/telegram.mjs")).default;
const bot = (await import("../netlify/functions/bot.mjs")).default;

const B = "https://giardino.test", CODE = "GRD-ABCDEF-GHJKLM-NPQRST-UVWXYZ", H = { "x-giardino-code": CODE };
async function call(fn, path, { method = "GET", body, headers = {} } = {}) {
  const r = await fn(new Request(B + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const leggiDati = async () => (await call(dati, "/api/dati", { headers: H })).body.data;
const PIANTE = [
  { id: "zuc", nome: "Zucchine", specie: "zucchina", fase: "vegetativa", colt: "vaso", vaso: 30, num: 1, luce: 8, dove: "aperto", zona: "Orto" },
  { id: "bas", nome: "Basilico", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 2, num: 1, luce: 8, dove: "aperto", zona: "Balcone" },
  { id: "pom", nome: "Pomodoro", specie: "pomodoro", fase: "fruttificazione", colt: "vaso", vaso: 12, num: 1, luce: 8, dove: "aperto", zona: "balcone" },
  { id: "agl", nome: "Aglio", specie: "aglio", fase: "auto", data_semina: OGGI, tipo_data: "semina", colt: "vaso", vaso: 30, num: 3, luce: 4, dove: "aperto" }
];

test("dati: il codice viaggia nell'intestazione (e ?code= vale ancora per le app vecchie)", async () => {
  assert.equal((await call(dati, "/api/dati")).status, 400);
  assert.deepEqual((await call(dati, "/api/dati", { headers: H })).body, { rev: 0, data: null });
  const r = await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { location: { name: "Castrocaro Terme", lat: 44.18, lon: 11.95 }, plants: PIANTE }, add: [{ id: "app-1", plantId: "bas", tipo: "fatto", data: OGGI, litri: 0.3 }] } });
  assert.equal(r.status, 200); assert.equal(r.body.data.plants.length, 4); assert.equal(r.body.data.eventi[0].fonte, "app");
  assert.equal((await call(dati, "/api/dati?code=" + CODE)).body.data.plants.length, 4);
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { remove: ["app-1"] } });
  assert.equal((await leggiDati()).eventi.length, 0);
  // controllo ogni 5 minuti: se l'app ha già l'ultima versione, il server risponde «invariato» con pochi byte
  const ora = (await call(dati, "/api/dati", { headers: H })).body, v = ora.rev + "-" + ora.updatedAt;
  const inv = await call(dati, "/api/dati", { headers: { ...H, "x-giardino-versione": v } });
  assert.deepEqual(inv.body, { rev: ora.rev, updatedAt: ora.updatedAt, invariato: true }); assert.ok(JSON.stringify(inv.body).length < 80);
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { vacanza: null } } });
  const nuovo = await call(dati, "/api/dati", { headers: { ...H, "x-giardino-versione": v } });
  assert.ok(nuovo.body.data && nuovo.body.rev === ora.rev + 1, "dopo una modifica arrivano i dati nuovi");
  // stato per le Impostazioni in una richiesta sola
  const st = (await call(dati, "/api/dati?op=stato", { headers: H })).body;
  assert.deepEqual(st.mcp, { active: false }); assert.deepEqual(st.telegram, { configured: false }); assert.ok(!("crediti" in st), "niente più stima dei crediti");
});

test("dati: risposte grandi compresse (gzip) se il telefono le accetta, in chiaro se le chiede così", async () => {
  const HZ = { "x-giardino-code": "GRD-GZGZGZ-GZGZGZ-GZGZGZ-GZGZGZ" };
  const eventi = [...Array(300)].map((_, i) => ({ id: "gz-" + i, plantId: "bas", tipo: "fatto", data: M.addDays(OGGI, -(i % 60)), litri: 0.3 }));
  await call(dati, "/api/dati", { method: "POST", headers: HZ, body: { changes: { plants: PIANTE }, add: eventi } });
  const chiedi = (h, path = "/api/dati", init = {}) => dati(new Request(B + path, { ...init, headers: { ...HZ, ...h } }));
  const testo = await (await chiedi({})).text();
  const z = await chiedi({ "accept-encoding": "gzip, deflate, br" }), buf = Buffer.from(await z.arrayBuffer());
  assert.equal(z.headers.get("content-encoding"), "gzip"); assert.equal(z.headers.get("content-type"), "application/json"); assert.equal(z.headers.get("cache-control"), "no-store");
  assert.equal(gunzipSync(buf).toString(), testo, "stesso contenuto");
  assert.ok(buf.length * 5 < testo.length, `compressi ${buf.length} byte invece di ${testo.length}`);
  // anche la risposta a un salvataggio (tutti i dati); in chiaro se l'app lo chiede, se il telefono non accetta gzip e se è piccola
  const p = await chiedi({ "accept-encoding": "gzip", "content-type": "application/json" }, "/api/dati", { method: "POST", body: JSON.stringify({ changes: { vacanza: null } }) });
  assert.equal(p.headers.get("content-encoding"), "gzip"); assert.equal(JSON.parse(gunzipSync(Buffer.from(await p.arrayBuffer()))).data.eventi.length, 300);
  assert.equal((await chiedi({ "accept-encoding": "gzip", "x-giardino-gzip": "no" })).headers.get("content-encoding"), null);
  assert.equal((await chiedi({ "accept-encoding": "br" })).headers.get("content-encoding"), null);
  const piccola = await chiedi({ "accept-encoding": "gzip" }, "/api/dati?op=versione");
  assert.equal(piccola.headers.get("content-encoding"), null); assert.ok((await piccola.json()).versione);
  assert.equal((await dati(new Request(B + "/api/dati", { headers: { "accept-encoding": "gzip" } }))).status, 400);
});

test("riconoscimento da foto (Pl@ntNet): chiave solo sul sito, specie dell'app dal nome", async () => {
  const foto = "data:image/jpeg;base64," + Buffer.from("finta foto").toString("base64");
  const chiedi = (b, h = H) => call(dati, "/api/dati?op=riconosci", { method: "POST", headers: h, body: b });
  delete process.env.PLANTNET_KEY;
  assert.equal((await chiedi({ immagine: foto })).status, 503, "senza chiave: non attivo");
  process.env.PLANTNET_KEY = "prova";
  assert.equal((await chiedi({ immagine: foto }, {})).status, 400, "serve il codice dell'app");
  assert.equal((await chiedi({ immagine: "ciao" })).status, 400, "solo foto");
  const r = (await chiedi({ immagine: foto })).body;
  assert.equal(r.risultati.length, 3); assert.equal(r.rimasti, 499);
  assert.deepEqual(r.risultati.map((x) => [x.specie, x.probabilita]), [["nepenthes", 82], ["appartamento", 7], [null, 3]]);
  assert.equal(r.risultati[0].nome, "Pianta brocca"); assert.equal(r.risultati[2].nome, "Strelitzia reginae", "senza nome italiano: lo scientifico");
  process.env.PLANTNET_KEY = "sbagliata"; assert.equal((await chiedi({ immagine: foto })).status, 502);
  delete process.env.PLANTNET_KEY;
});

test("meteo: se Open-Meteo non risponde, MET Norway con i giorni passati dall'ultimo meteo buono", async () => {
  const { meteo } = await import("../netlify/lib/core.mjs");
  const st = getStore({ name: "giardino" }), key = "c-meteo-44.30,11.70";
  await st.delete(key);
  const buono = await meteo(44.3, 11.7);                     // Open-Meteo (finto) risponde
  await st.setJSON(key, { at: Date.now() - 20 * 60e3, met: buono });   // scaduto: la prossima volta riprova
  const vero = globalThis.fetch, oggi = buono.days.find((d) => d.date >= new Date().toISOString().slice(0, 10)).date;
  const ts = [...Array(60)].map((_, h) => ({ time: new Date(Date.now() + h * 36e5).toISOString().slice(0, 13) + ":00:00Z", data: { instant: { details: { air_temperature: 9, wind_speed: 2 } }, next_1_hours: { summary: { symbol_code: "rain" }, details: { precipitation_amount: 1 } } } }));
  let ua = "";
  globalThis.fetch = async (u, o) => { u = String(u); if (u.includes("api.open-meteo.com") && !u.includes("historical")) return new Response("", { status: 502 });
    if (u.includes("api.met.no")) { ua = o?.headers?.["user-agent"] || ""; return Response.json({ properties: { timeseries: ts } }); } return vero(u, o); };
  try {
    const m = await meteo(44.3, 11.7);
    assert.match(m.fonte, /MET Norway/); assert.match(ua, /giardino-fede\.netlify\.app/, "MET chiede di farsi riconoscere");
    assert.ok(m.days.some((d) => d.date < oggi), "giorni passati dall'ultimo meteo buono");
    assert.ok(m.days.find((d) => d.date === oggi).rain > 0 && m.days.find((d) => d.date === oggi).prob === null);
  } finally { globalThis.fetch = vero; }
});

test("pioggia misurata ARPAE: stazione più vicina, giorni completi, nei dati e nel piano", async () => {
  const C = await import("../netlify/lib/core.mjs");
  // file come realtime.jsonl: Castrocaro (1 km, ogni ora) e una stazione più lontana senza pluviometro
  const righe = [], ieri = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const giorno = (iso) => [...Array(27)].map((_, h) => new Date(Date.parse(iso + "T00:00:00Z") - 2 * 36e5 + h * 36e5).toISOString().replace(".000", ""));
  for (const t of giorno(ieri)) righe.push(JSON.stringify({ network: "locali", lon: 1194940, lat: 4417012, date: t, data: [{ vars: { B01019: { v: "Castrocaro" } } }, { timerange: [1, 0, 3600], vars: { B13011: { v: 0.5 } } }] }));
  righe.push(JSON.stringify({ network: "agrmet", lon: 1202757, lat: 4422698, date: ieri + "T10:00:00Z", data: [{ vars: { B01019: { v: "Forlì" } } }, { timerange: [0, 0, 900], vars: { B12101: { v: 283 } } }] }));
  const letto = C.leggiArpae(righe.join("\n"), 44.18, 11.95);
  assert.equal(letto.stazione.nome, "Castrocaro"); assert.ok(letto.stazione.km < 2);
  const g = C.giorniMisurati(letto.ore, "UTC");
  assert.equal(g[ieri], 12, "24 ore × 0,5 mm"); assert.equal(Object.keys(g).length, 1, "i giorni incompleti non contano");
  assert.equal(C.inEmiliaRomagna(44.18, 11.95), true); assert.equal(C.inEmiliaRomagna(41.9, 12.5), false);
  // il bot scrive i giorni nei dati; il piano usa la pioggia misurata
  const vero = globalThis.fetch;
  globalThis.fetch = async (u, o) => String(u).includes("dati-simc.arpae.it") ? new Response(righe.join("\n")) : vero(u, o);
  try { await C.aggiornaPioggiaMisurata(getStore({ name: "giardino" })); } finally { globalThis.fetch = vero; }
  const d = await leggiDati();
  assert.equal(d.pioggia_misurata.stazione, "Castrocaro");
  // l'app chiede le misure per «l'ho messa sotto la pioggia»: dall'archivio (aggiornato da meno di 15 minuti)
  const pg = (await call(dati, "/api/dati?op=pioggia", { headers: H })).body;
  assert.ok(pg.disponibile && pg.stazione === "Castrocaro" && Object.keys(pg.ore).length >= 24);
  const giorni = M.conPioggiaMisurata([{ date: ieri, rain: 3 }, { date: OGGI, rain: 1 }], d.pioggia_misurata, OGGI);
  assert.ok(Object.values(d.pioggia_misurata.giorni).length >= 1);
  assert.equal(giorni[1].rain, 1, "oggi resta la previsione");
});

test("meteo: due richieste in parallelo, poi 15 minuti dall'archivio", async () => {
  const { meteo } = await import("../netlify/lib/core.mjs");
  const st = getStore({ name: "giardino" }), key = "c-meteo-44.18,11.95";
  await st.delete(key);
  const m1 = await meteo(44.18, 11.95);
  assert.ok(m1.days.length === 11 && m1.notte?.length && m1.suolo === 0.2, "giornaliero e orario dalla stessa richiesta");
  const c = await st.get(key, { type: "json" }); assert.ok(c && c.at <= Date.now());
  await st.setJSON(key, { ...c, met: { ...c.met, days: c.met.days.map((d, i) => (i ? d : { ...d, cond: "dall'archivio" })) } });
  assert.equal((await meteo(44.18, 11.95)).days[0].cond, "dall'archivio");
  await st.setJSON(key, { ...c, at: Date.now() - 16 * 60e3 });
  assert.notEqual((await meteo(44.18, 11.95)).days[0].cond, "dall'archivio", "dopo 15 minuti si riscarica");
});

let KEY;
const rpc = async (method, params = {}) => (await call(mcp, "/mcp/" + KEY, { method: "POST", body: { jsonrpc: "2.0", id: 1, method, params } })).body;
const strumento = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result;

test("connettore per Claude: lettura, zona, ordine alfabetico, permessi", async () => {
  KEY = (await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "on" } })).body.token;
  assert.match(KEY, /^[A-Z2-7]{26}$/);
  assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "giardino");
  assert.equal((await rpc("tools/list")).result.tools.length, 14);
  assert.equal((await rpc("initialize", {})).result.serverInfo.version, "2.0.0");
  const g = (await strumento("giardino")).content[0].text;
  const ordine = ["Basilico", "Pomodoro", "Zucchine", "Aglio"].map((n) => g.indexOf("**" + n + "**"));
  assert.ok(ordine.every((x, i) => x > 0 && (!i || x > ordine[i - 1])), "piante per zona e in ordine alfabetico");
  assert.match(g, /\*\*Basilico\*\* \[id bas\] · zona Balcone/);
  const m = await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { zona: "  Orto  " } });
  assert.equal(m.isError, false);
  assert.equal((await leggiDati()).plants.find((p) => p.id === "agl").zona, "Orto");
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { colore: "rosso" } })).isError, true);
  // raccolto dal connettore: quantità e unità obbligatorie
  assert.equal((await strumento("registra", { pianta: "agl", tipo: "raccolto", quantita: 3 })).isError, true);
  assert.equal((await strumento("registra", { pianta: "agl", tipo: "raccolto", quantita: 3, unita: "pezzi" })).isError, false);
  { const e = (await leggiDati()).eventi.filter((x) => x.tipo === "raccolto").pop(); assert.deepEqual([e.quantita, e.unita, e.fonte], [3, "pezzi", "claude"]); }
  // verso dove guarda: anche due direzioni (angolo), scritte in qualunque ordine; sigle sbagliate rifiutate
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { orient: "O, S", luce_data: OGGI } })).isError, false);
  assert.equal((await leggiDati()).plants.find((p) => p.id === "agl").orient, "S,O");
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { orient: "sopra" } })).isError, true);
  await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { orient: "", luce_data: "" } });
  // temperatura in casa
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { tcasa: { inverno: 18 } } })).isError, false);
  assert.deepEqual((await leggiDati()).plants.find((p) => p.id === "agl").tcasa, { inverno: 18 });
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { tcasa: { estate: 50 } } })).isError, true);
  // scheda della pianta
  assert.match((await strumento("giardino")).content[0].text, /\*\*Aglio\*\*[\s\S]*?scheda: DA COMPILARE/);
  const sc = await strumento("salva_scheda", { pianta: "agl", descrizione: "Bulbo da piantare in autunno.", condizioni: { luce: "Pieno sole", acqua: "Poca" },
    stagioni: { inverno: "Cresce piano, resiste al gelo" }, calendario: [{ mese: OGGI.slice(0, 7), fase: "Radicazione", nota: "Niente acqua se piove" }, { mese: "2027-06", fase: "Raccolta", raccolta: true }, { mese: "13", fase: "x" }] });
  assert.equal(sc.isError, false);
  const agl = (await leggiDati()).plants.find((p) => p.id === "agl");
  assert.equal(agl.scheda.calendario.length, 2, "il mese 13 viene scartato");
  assert.match(sc.content[0].text, /allineato anche le fasi automatiche dell'app: raccolta da 2027-06/);
  assert.equal(agl.raccolta, "2027-06", "la raccolta della scheda guida le fasi dell'app");
  assert.equal(agl.scheda.specie, "aglio");
  assert.match((await strumento("giardino")).content[0].text, /scheda: compilata da te il/);
  assert.equal((await strumento("salva_scheda", { pianta: "agl", calendario: [] })).isError, true);
  // anche senza «salva_scheda» (elenco di strumenti vecchio nel client) la scheda si scrive con «modifica_pianta»
  assert.match((await strumento("giardino")).content[0].text, /Come scrivere le schede[\s\S]*modifica_pianta/);
  const mp = await strumento("modifica_pianta", { azione: "modifica", pianta: "zuc", campi: { scheda: { descrizione: "Ortaggio estivo.", calendario: [{ mese: 7, fase: "Frutti", frutti: true }] } } });
  assert.equal(mp.isError, false, mp.content[0].text);
  const zuc = (await leggiDati()).plants.find((p) => p.id === "zuc");
  assert.equal(zuc.scheda.calendario[0].mese, "07"); assert.equal(zuc.scheda.specie, "zucchina"); assert.ok(zuc.scheda.aggiornata);
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "zuc", campi: { scheda: { descrizione: "senza calendario" } } })).isError, true);
  // l'app manda le piante senza scheda (o con una più vecchia): la scheda di Claude resta
  const piante = (await leggiDati()).plants.map(({ scheda, ...p }) => (p.id === "bas" ? { ...p, note: "dall'app" } : p));
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: piante } } });
  let d = await leggiDati();
  assert.equal(d.plants.find((p) => p.id === "bas").note, "dall'app");
  assert.equal(d.plants.find((p) => p.id === "agl").scheda.descrizione, "Bulbo da piantare in autunno.");
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: d.plants.map((p) => (p.id === "agl" ? { ...p, scheda: { ...p.scheda, descrizione: "vecchia", aggiornata: "2020-01-01T00:00:00Z" } } : p)) } } });
  assert.equal((await leggiDati()).plants.find((p) => p.id === "agl").scheda.descrizione, "Bulbo da piantare in autunno.");
  // livello dell'acqua e prossima innaffiatura nel riepilogo
  assert.match((await strumento("giardino")).content[0].text, /acqua nel terriccio a fine giornata ~\d+% \(si innaffia sotto \d+%\)/);
  // una pianta in dettaglio: scheda dell'app se Claude non l'ha scritta
  const pb = (await strumento("pianta", { pianta: "Basilico" })).content[0].text;
  assert.match(pb, /Scheda dell'app[\s\S]*luce:/); assert.match(pb, /## Piano/);
  // diagnosi: senza registra non scrive, con registra salva «meno»
  const dg = (await strumento("diagnosi", { pianta: "bas", sintomi: ["bagnato", "gialle_molli", "inesistente"] })).content[0].text;
  assert.match(dg, /Troppa acqua[\s\S]*registra: true/);
  assert.ok(!(await leggiDati()).eventi.some((e) => e.plantId === "bas" && e.tipo === "meno"));
  assert.match((await strumento("diagnosi", { pianta: "bas", sintomi: ["bagnato", "marciume"], registra: true })).content[0].text, /Registrato «meno»: correzione appresa ora ×0,9/);
  const meno = (await leggiDati()).eventi.find((e) => e.plantId === "bas" && e.tipo === "meno");
  assert.ok(meno && meno.fonte === "claude");
  assert.equal((await strumento("diagnosi", { pianta: "bas", sintomi: [] })).isError, true);
  // annulla: toglie l'evento per id
  assert.match((await strumento("diario", { giorni: 3 })).content[0].text, new RegExp("\\[" + meno.id + "\\]"));
  assert.match((await strumento("annulla", { id: meno.id })).content[0].text, /Tolto dal diario: Basilico — meno/);
  assert.ok(!(await leggiDati()).eventi.some((e) => e.id === meno.id));
  assert.equal((await strumento("annulla", { id: "nessuno" })).isError, true);
  // nuova pianta senza specie: riconosciuta dal nome
  assert.match((await strumento("modifica_pianta", { azione: "aggiungi", campi: { nome: "Monstera deliciosa", dove: "interno" } })).content[0].text, /Monstera \/ pothos \/ filodendro \(riconosciuta dal nome\)/);
  // piano: litri oltre quello che il vaso trattiene ridotti, giorni fuori periodo scartati; poi di nuovo calcolo automatico
  const sp = (await strumento("salva_piano", { piante: [{ id: "bas", giorni: [{ data: OGGI, azione: "innaffia", litri: 50 }, { data: "2020-01-01", azione: "innaffia", litri: 1 }] }] })).content[0].text;
  assert.match(sp, /50 L ridotti a/); assert.match(sp, /1 giorni fuori dal periodo/);
  const pc = (await leggiDati()).piano_claude.data.piante[0];
  assert.equal(pc.giorni.length, 1); assert.ok(pc.giorni[0].litri < 2);
  assert.match((await strumento("piano_automatico")).content[0].text, /calcolo automatico/);
  // giorno di pioggia: per una pianta in casa il messaggio spiega perché va bagnata lo stesso
  const { notaPioggia } = await import("../netlify/lib/core.mjs");
  assert.equal(notaPioggia({ dove: "interno" }, { rain: 8 }), "in casa: la pioggia non la raggiunge");
  assert.equal(notaPioggia({ dove: "aperto" }, { rain: 8 }), ""); assert.equal(notaPioggia({ dove: "interno" }, { rain: 0 }), "");
  assert.equal((await leggiDati()).piano_claude, null);
  // impostazioni
  assert.equal((await strumento("impostazioni", { ora_sera: 20, bicchiere: 0.3 })).isError, false);
  assert.equal((await leggiDati()).impostazioni.ora_sera, 20);
  assert.equal((await strumento("impostazioni", { ora_mattina: 2 })).isError, true);
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: false } });
  assert.equal((await strumento("vacanza", { annulla: true })).isError, true);
  assert.match((await strumento("diagnosi", { pianta: "bas", sintomi: ["secco"], registra: true })).content[0].text, /Modifiche non permesse/);
  assert.equal((await call(mcp, "/mcp/AAAAAAAAAAAAAAAAAAAAAAAAAA", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "ping" } })).status, 401);
});

let SECRET;
const webhook = (u) => call(telegram, "/api/telegram/" + SECRET, { method: "POST", body: u, headers: { "x-telegram-bot-api-secret-token": SECRET } });
const tastiere = () => inviati.filter((x) => x[0] === "sendMessage" && x[1].reply_markup).map((x) => x[1].reply_markup.inline_keyboard);

test("Telegram: collegamento, /oggi con «Annaffiato» e «Terreno ancora umido», pulsanti, /fatto per zona", async () => {
  const r = await call(dati, "/api/dati?op=telegram", { method: "POST", headers: H, body: { action: "token", token: "123456789:AAHfakefakefakefakefakefakefakefake" } });
  assert.equal(r.body.configured, true);
  SECRET = inviati.find((x) => x[0] === "setWebhook")[1].secret_token;
  assert.equal((await call(telegram, "/api/telegram/" + SECRET, { method: "POST", body: {} })).status, 403);
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/start" } });
  assert.equal((await call(dati, "/api/dati?op=telegram", { headers: H })).body.collegato, true);

  inviati.length = 0;
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/oggi" } });
  const kb = tastiere()[0], testi = kb.flat().map((b) => b.text);
  assert.ok(testi.some((t) => t.startsWith("✅ Annaffiato")), "pulsante Annaffiato");
  assert.ok(testi.includes("💦 Terreno ancora umido"), "pulsante Terreno ancora umido");
  const msg = inviati.find((x) => x[0] === "sendMessage")[1].text;
  assert.ok(msg.indexOf("Basilico") < msg.indexOf("Pomodoro") && msg.indexOf("Pomodoro") < msg.indexOf("Zucchine"), "piante in ordine");

  // pulsante “Terreno ancora umido”: registrato e le due righe della pianta diventano una
  const righe = kb.filter((r) => r.some((b) => b.callback_data.includes("|bas|") && !b.callback_data.endsWith("|c")));
  assert.equal(righe.length, 2);
  inviati.length = 0;
  await webhook({ callback_query: { id: "cb1", data: `g|${OGGI}|bas|u`, message: { message_id: 5, chat: { id: 77 }, reply_markup: { inline_keyboard: kb } } } });
  const ev = (await leggiDati()).eventi.find((e) => e.plantId === "bas");
  assert.equal(ev.tipo, "umido"); assert.equal(ev.fonte, "telegram");
  assert.match(inviati.find((x) => x[0] === "answerCallbackQuery")[1].text, /Basilico — terreno ancora umido/);
  const nuova = inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup.inline_keyboard;
  assert.equal(nuova.length, kb.length - 1);
  assert.equal(nuova.filter((r) => r[0].text.startsWith("✔ Basilico")).length, 1);

  // «↩️ Annulla»: toglie la risposta e rimette i pulsanti com'erano
  const annullaB = nuova.flat().find((b) => b.text === "↩️ Annulla");
  assert.ok(annullaB && annullaB.callback_data.length <= 64, "pulsante Annulla (callback entro 64 byte)");
  inviati.length = 0;
  await webhook({ callback_query: { id: "cb2", data: annullaB.callback_data, message: { message_id: 5, chat: { id: 77 }, reply_markup: { inline_keyboard: nuova } } } });
  assert.ok(!(await leggiDati()).eventi.some((e) => e.plantId === "bas" && e.fonte === "telegram"), "risposta tolta");
  assert.match(inviati.find((x) => x[0] === "answerCallbackQuery")[1].text, /Annullato: Basilico/);
  const ripristinata = inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup.inline_keyboard;
  assert.deepEqual(ripristinata, kb, "pulsanti di prima");
  // di nuovo «Terreno ancora umido» (serve per /fatto qui sotto)
  await webhook({ callback_query: { id: "cb3", data: `g|${OGGI}|bas|u`, message: { message_id: 5, chat: { id: 77 }, reply_markup: { inline_keyboard: ripristinata } } } });
  assert.equal((await leggiDati()).eventi.filter((e) => e.plantId === "bas" && e.tipo === "umido").length, 1);

  // controllo della settimana da Telegram: «asciutto» quando il calcolo vedeva l'80% d'acqua → beve di più
  inviati.length = 0;
  await webhook({ callback_query: { id: "cbv", data: `v|${OGGI}|agl|s|80|50`, message: { message_id: 9, chat: { id: 77 }, reply_markup: { inline_keyboard: [] } } } });
  const ver = (await leggiDati()).eventi.find((e) => e.tipo === "verifica" && e.plantId === "agl");
  assert.ok(ver && ver.valutazione === "piu" && ver.esito === "secco" && ver.fonte === "telegram");
  assert.match(inviati.find((x) => x[0] === "answerCallbackQuery")[1].text, /beve di più/);
  // /fatto balcone: solo la zona Balcone (il basilico ha già una risposta, resta il pomodoro)
  inviati.length = 0;
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/fatto Balcone" } });
  assert.match(inviati.at(-1)[1].text, /Segnate come annaffiate: Pomodoro\./);
  const d = await leggiDati();
  assert.ok(d.eventi.some((e) => e.plantId === "pom" && e.tipo === "fatto"));
  assert.ok(!d.eventi.some((e) => e.plantId === "zuc"), "la zona Orto resta da fare");
  inviati.length = 0;
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/fatto cantina" } });
  assert.match(inviati.at(-1)[1].text, /Non trovo «cantina»/);
  // /fatto aglio: segna l'aglio anche se oggi non era in programma
  inviati.length = 0;
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/fatto aglio" } });
  assert.match(inviati.at(-1)[1].text, /Segnate come annaffiate: Aglio\./);
  const ag = (await leggiDati()).eventi.find((e) => e.plantId === "agl" && e.tipo === "fatto");
  assert.ok(ag && ag.litri > 0);
});

test("bot orario: promemoria della sera con «Annaffiato» e «Terreno ancora umido» a tutta riga", async () => {
  const st = getStore({ name: "giardino" }), t = await st.get("t-" + CODE, { type: "json" });
  // fuso scelto perché lì adesso siano le 12: mattino e sera partono nello stesso giro (orari impostati a 7 e 12)
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  await st.setJSON("t-" + CODE, { ...t, tz, ultimo_invio: null, ultimo_avviso_sera: null, inviati_il: {}, segnati_il: null, ultimo_backup: new Date().toISOString().slice(0, 7) });
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12 } } } });
  inviati.length = 0;
  await bot();
  const mattino = inviati.find((x) => x[0] === "sendMessage" && x[1].text.includes("Giardino —"));
  assert.ok(mattino, "messaggio del mattino");
  const sera = inviati.find((x) => x[0] === "sendMessage" && x[1].text.includes("Ancora da innaffiare"));
  assert.ok(sera, "promemoria della sera");
  const kb = sera[1].reply_markup.inline_keyboard;
  assert.ok(kb.every((r) => r.length === 1), "una sola pulsante per riga");
  assert.ok(kb.some((r) => r[0].text.startsWith("✅ Annaffiato")) && kb.some((r) => r[0].text.startsWith("💦 Terreno ancora umido")));
  assert.ok(!kb.flat().some((b) => b.text.includes("Salto")));
  inviati.length = 0; await bot();
  assert.equal(inviati.filter((x) => x[0] === "sendMessage").length, 0, "una volta al giorno");
  // due giri del bot nello stesso momento (Netlify a volte lo avvia due volte): un messaggio solo
  const t1 = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t1, tz, ultimo_invio: null, ultimo_avviso_sera: null, inviati_il: {}, segnati_il: null });
  inviati.length = 0; await Promise.all([bot(), bot()]);
  assert.equal(inviati.filter((x) => x[0] === "sendMessage" && x[1].text.includes("Giardino —")).length, 1, "mattino una volta sola");
  assert.equal(inviati.filter((x) => x[0] === "sendMessage" && x[1].text.includes("Ancora da innaffiare")).length, 1, "sera una volta sola");
});

test("notifiche spente in Impostazioni: il bot non le manda (il promemoria della sera sì, anche senza mattino)", async () => {
  const st = getStore({ name: "giardino" }), t0 = await st.get("t-" + CODE, { type: "json" });
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  const giro = async (notifiche) => {
    const t = await st.get("t-" + CODE, { type: "json" });
    await st.setJSON("t-" + CODE, { ...t, tz, ultimo_invio: null, ultimo_avviso_sera: null, inviati_il: {}, segnati_il: null, ultimo_backup: null, notificati: {} });
    await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12, notifiche } } } });
    inviati.length = 0; await bot();
    const testi = inviati.filter((x) => x[0] === "sendMessage").map((x) => x[1].text);
    return { mattino: testi.some((x) => x.includes("Giardino —")), sera: testi.some((x) => x.includes("Ancora da innaffiare")), backup: inviati.some((x) => x[0] === "sendDocument"), n: testi.length };
  };
  const tutte = await giro({});
  assert.ok(tutte.mattino && tutte.sera, "con tutto acceso: mattino e sera");
  const senzaMattino = await giro({ mattina: false, backup: false });
  assert.ok(!senzaMattino.mattino, "mattino spento"); assert.ok(senzaMattino.sera, "la sera arriva lo stesso, con le piante di oggi"); assert.ok(!senzaMattino.backup, "backup spento");
  const nessuna = await giro(Object.fromEntries(["mattina", "sera", "controllo", "avvisi", "verifica", "riepilogo", "backup", "piano"].map((k) => [k, false])));
  assert.equal(nessuna.n, 0, "tutto spento: nessun messaggio"); assert.ok(!nessuna.backup);
  const t = await st.get("t-" + CODE, { type: "json" }), oggi = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  assert.equal(t.ultimo_invio, oggi); assert.equal(t.ultimo_avviso_sera, oggi); assert.deepEqual(t.notificati, {}, "nessuna pianta segnata: domani niente innaffiature presunte");
  // dal connettore: Claude riaccende il mattino e spegne il riepilogo; le altre restano come sono
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  const r = await strumento("impostazioni", { notifiche: { mattina: true, riepilogo: false } });
  assert.match(r.content[0].text, /notifica mattina accesa.*notifica riepilogo spenta/);
  const n = (await leggiDati()).impostazioni.notifiche;
  assert.ok(!("mattina" in n) && n.riepilogo === false && n.sera === false && n.piano === false);
  assert.ok((await strumento("impostazioni", { notifiche: { boh: false } })).isError, "tipo sconosciuto");
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12 } } } });
  await st.setJSON("t-" + CODE, { ...t0 });
});

test("controlli del terreno: la sera le piante da toccare col dito ancora senza risposta, coi pulsanti; mai innaffiature presunte", async () => {
  const st = getStore({ name: "giardino" }), t0 = await st.get("t-" + CODE, { type: "json" }), d0 = await leggiDati();
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  const fic = { id: "fic", nome: "Ficus", specie: "tropicale", fase: "vegetativa", colt: "vaso", vaso: 3, diametro: 17, num: 1, luce: 2, dove: "interno" };
  const giorno = (azione) => ({ data: OGGI, azione, litri: azione === "innaffia" ? 0.5 : 0, momento: "mattina presto", motivo: "prova" });
  const piano = { createdAt: new Date().toISOString(), source: "claude", data: { sintesi: "prova", avvisi: [], piante: [{ id: "fic", giorni: [giorno("controlla")] }, { id: "zuc", giorni: [giorno("innaffia")] }] } };
  const imp = (notifiche) => ({ bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12, ...(notifiche ? { notifiche } : {}) });
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: [...d0.plants, fic], piano_claude: piano, vacanza: null, impostazioni: imp({ controllo: false }) } } });
  const giro = async () => {
    const t = await st.get("t-" + CODE, { type: "json" });
    await st.setJSON("t-" + CODE, { ...t, tz, ultimo_invio: null, ultimo_avviso_sera: null, inviati_il: {}, segnati_il: null, ultimo_backup: new Date().toISOString().slice(0, 7), notificati: {} });
    inviati.length = 0; await bot();
    return inviati.filter((x) => x[0] === "sendMessage" && x[1].text.includes("Da controllare oggi"));
  };
  assert.equal((await giro()).length, 0, "spenti in Impostazioni: niente");
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: imp() } } });
  const [m] = await giro();
  assert.ok(m, "promemoria dei controlli");
  assert.match(m[1].text, /Ficus<\/b>: infila un dito nel terriccio per \d\u00a0cm.*\. Se è asciutto, innaffia: \d+(,\d+)? L \(/);
  assert.ok(!m[1].text.includes("Zucchine"), "la pianta da innaffiare sta nell'altro promemoria");
  assert.ok(!/la conto come annaffiata/.test(m[1].text), "un controllo non diventa mai un'innaffiatura data per fatta");
  const kb = m[1].reply_markup.inline_keyboard, suoi = kb.filter((r) => r.some((b) => b.callback_data.includes("|fic|")));
  assert.deepEqual(suoi.flat().map((b) => b.text.replace(/ · .*/, "")), ["🏜 Era secca: annaffiato", "💦 Terreno ancora umido"]);
  assert.ok(kb.every((r) => r.length === 1) && !kb.flat().some((b) => b.text.includes("Salto")), "a tutta riga, senza «Salto»");
  const t = await st.get("t-" + CODE, { type: "json" });
  assert.ok(!(t.notificati?.[OGGI] || []).some((n) => n.id === "fic"), "mai tra le innaffiature notificate: domani non diventa «data per fatta»");
  // «Era secca: annaffiato» con la dose (prima, senza un piano con i litri, l'innaffiatura restava senza quantità)
  inviati.length = 0;
  await webhook({ callback_query: { id: "cbc", data: suoi[0][0].callback_data, message: { message_id: 11, chat: { id: 77 }, reply_markup: { inline_keyboard: kb } } } });
  const e = (await leggiDati()).eventi.find((x) => x.plantId === "fic" && x.tipo === "secco");
  assert.ok(e && e.litri > 0 && e.previsto === "controlla", "registrata con litri e con quello che diceva il piano");
  const annullaB = inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup.inline_keyboard.flat().find((b) => b.text === "↩️ Annulla");
  assert.ok(!(await giro()).some((x) => x[1].text.includes("Ficus")), "con una risposta non si ripete");
  // pulizia: via la risposta, la pianta e il piano di prova
  await webhook({ callback_query: { id: "cbz", data: annullaB.callback_data, message: { message_id: 11, chat: { id: 77 }, reply_markup: { inline_keyboard: [] } } } });
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: d0.plants, piano_claude: d0.piano_claude, vacanza: d0.vacanza, impostazioni: d0.impostazioni } } });
  await st.setJSON("t-" + CODE, { ...t0 });
  assert.ok(!(await leggiDati()).eventi.some((x) => x.plantId === "fic"));
});

test("fine del piano di Claude: avviso su Telegram una volta per piano, poi calcolo automatico", async () => {
  const { pianoAttivo, finePiano } = await import("../netlify/lib/core.mjs");
  const domani = new Date(Date.parse(OGGI + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
  const piano = { createdAt: new Date().toISOString(), source: "claude", data: { sintesi: "prova", avvisi: [], piante: [{ id: "zuc", giorni: [OGGI, domani].map((data) => ({ data, azione: "salta", litri: 0, momento: "indifferente", motivo: "prova" })) }] } };
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { piano_claude: piano } } });
  assert.equal(finePiano(piano), domani);
  // dopo l'ultimo giorno di Claude, i giorni vengono dal calcolo automatico
  const d = await leggiDati(), met = { days: [], suolo: null };
  const giorni = []; for (let i = -3; i < 8; i++) giorni.push(new Date(Date.parse(OGGI + "T12:00:00Z") + i * 864e5).toISOString().slice(0, 10));
  met.days = giorni.map((date) => ({ date, cond: "sereno", tmax: 24, tmin: 12, rain: 0, prob: 5, et0: 4, wind: 10 }));
  const ap = pianoAttivo(d, met, OGGI), zg = ap.piano.piante.find((x) => x.id === "zuc").giorni;
  assert.equal(ap.fonte, "Claude");
  assert.ok(zg.length >= 7 && zg.filter((g) => g.auto).length >= 5, "giorni automatici dopo la fine del piano");
  // la sera: messaggio con il pulsante per aprire Claude, una volta sola
  // fuso in cui adesso sono le 12 (dopo il primo giro il bot salva il fuso del meteo finto, UTC)
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  const st = getStore({ name: "giardino" }), t = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t, tz, ultimo_avviso_sera: null, inviati_il: {} });
  inviati.length = 0; await bot();
  const msg = inviati.find((x) => x[0] === "sendMessage" && x[1].text.includes("Il piano di Claude"));
  assert.ok(msg, "avviso di fine piano");
  assert.match(msg[1].text, /finisce domani/);
  assert.match(msg[1].reply_markup.inline_keyboard[0][0].url, /^https:\/\/claude\.ai\/new\?q=/);
  const t2 = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t2, tz, ultimo_avviso_sera: null, inviati_il: {} });
  inviati.length = 0; await bot();
  assert.ok(!inviati.some((x) => x[0] === "sendMessage" && x[1].text.includes("Il piano di Claude")), "non si ripete per lo stesso piano");
});

test("bot di riserva su GitHub: copia cifrata col sito vivo, messaggio su Telegram col sito fermo", async () => {
  const { riserva, cifra, decifra } = await import("../../giardino/riserva.mjs");
  const { mkdtemp } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const file = join(await mkdtemp(join(tmpdir(), "riserva-")), "dati.enc"), x = { a: 1 };
  assert.deepEqual(decifra(cifra(x, CODE), CODE), x); assert.throws(() => decifra(cifra(x, CODE), "ALTRO-CODICE-XXXXXXXX"));
  const vero = globalThis.fetch, log = () => {};
  // sito vivo: il «sito» sono le funzioni vere dei test
  globalThis.fetch = async (u, o = {}) => { u = String(u); if (u.startsWith("https://sito.test")) return dati(new Request(u.replace("https://sito.test", B), { headers: o.headers })); return vero(u, o); };
  try {
    assert.equal((await riserva({ sito: "https://sito.test", codice: CODE, token: "123:abc", chat: 77, file, tentativi: 1, attesa: 0, log })).azione, "copia");
    const copia = decifra(await (await import("node:fs/promises")).readFile(file, "utf8"), CODE);
    assert.ok(copia.data.plants.length >= 4 && !JSON.stringify(copia).includes("123:abc"));
    // sito fermo: messaggio di riserva con il piano di oggi, senza pulsanti
    globalThis.fetch = async (u, o) => (String(u).startsWith("https://sito.test") ? new Response("Site not available", { status: 503 }) : vero(u, o));
    inviati.length = 0;
    assert.equal((await riserva({ sito: "https://sito.test", codice: CODE, token: "123:abc", chat: 77, file, tentativi: 1, attesa: 0, log })).azione, "telegram");
    const m = inviati.find((y) => y[0] === "sendMessage")[1];
    assert.match(m.text, /Il sito Giardino non risponde[\s\S]*copia di riserva[\s\S]*Giardino —/); assert.equal(m.chat_id, 77); assert.ok(!m.reply_markup);
  } finally { globalThis.fetch = vero; }
});

test("correzione del consumo nei messaggi e nel connettore: la stessa del bilancio dell'app", async () => {
  const C = await import("../netlify/lib/core.mjs"), M = await import("../netlify/lib/modello.mjs");
  const oggi = "2026-07-20", serie = (da, n) => [...Array(n)].map((_, i) => ({ date: M.addDays(da, i), tmax: 18, tmin: 10, et0: 2, rain: 0, prob: 0, wind: 5 }));
  const p = { id: "ba", nome: "Basilico", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 3, luce: 6, dove: "riparato" };
  const t0 = M.addDays(oggi, -12), eventi = [{ id: "f", plantId: "ba", tipo: "fatto", data: t0, fonte: "app" }, { id: "u", plantId: "ba", tipo: "umido", data: M.addDays(t0, 6), fonte: "telegram" }];
  const met = { lat: 44, days: [...serie(M.addDays(oggi, -3), 3), ...serie(oggi, 7)], archivio: Object.fromEntries(serie(M.addDays(oggi, -120), 117).map((d) => [d.date, [d.tmin, d.tmax, 0, 2, null, 5]])) };
  const data = { location: { lat: 44, lon: 11.9 }, plants: [p], eventi };
  const atteso = M.pianoLocale({ piante: [p], past: M.giorniPassati(met, null, oggi), fut: met.days.filter((d) => d.date >= oggi), eventi, oggi, lat: 44 }).piante[0].calibrazione;
  assert.ok(atteso < 0.95, "il controllo «era umida» abbassa il consumo");
  assert.equal(C.calibrazioneVera({ ...data, eventi: [...eventi] }, met, "ba", oggi), atteso, "stessa stima anche con un elenco di eventi nuovo");
  assert.match(C.riepilogoSettimana({ ...data, eventi: [...eventi] }, oggi, met), new RegExp("ora conto il " + Math.round((1 - atteso) * 100) + "% in meno"));
});

test("più orti: un messaggio per orto (col suo nome), connettore orto per orto, pioggia misurata per orto", async () => {
  const st = getStore({ name: "giardino" }), C2 = "GRD-PIUORT-ABCDEF-GHJKLM-NPQRST", H2 = { "x-giardino-code": C2 };
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  await call(dati, "/api/dati", { method: "POST", headers: H2, body: { changes: {
    location: { name: "Castrocaro Terme", lat: 44.18, lon: 11.95 },
    orti: [{ id: "o1", nome: "Mare", location: { name: "Rimini", lat: 44.06, lon: 12.57 } }, { id: "o2", nome: "Vuoto", location: { name: "Bologna", lat: 44.49, lon: 11.34 } }],
    plants: [{ ...PIANTE[0] }, { ...PIANTE[1], orto: "o1" }, { ...PIANTE[2], orto: "sparito" }],
    impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12 } } } });
  const d0 = (await call(dati, "/api/dati", { headers: H2 })).body.data;
  // viste: il pomodoro con un orto che non esiste più torna nel principale; l'orto senza piante non conta
  assert.deepEqual(M.orti(d0).map((o) => M.nomeOrto(o)), ["Castrocaro Terme", "Mare", "Vuoto"]);
  assert.deepEqual(M.vistaOrto(d0, "p").plants.map((p) => p.id), ["zuc", "pom"]);
  assert.deepEqual(M.vistaOrto(d0, "o1").plants.map((p) => p.id), ["bas"]);
  assert.equal(M.vistaOrto(d0, "o1").location.name, "Rimini");
  assert.deepEqual(M.vistePiene(d0).map((v) => v.orto.id), ["p", "o1"]);
  // Telegram: mattino e sera, un messaggio per orto
  await st.setJSON("t-" + C2, { token: "TOK2", chat_id: 99, tz, notificati: {}, ultimo_invio: null, ultimo_avviso_sera: null, inviati_il: {}, segnati_il: null, ultimo_backup: new Date().toISOString().slice(0, 7) });
  inviati.length = 0; await bot();
  const miei = inviati.filter((x) => x[0] === "sendMessage" && x[1].chat_id === 99).map((x) => x[1].text);
  const mattino = miei.filter((x) => /^🪴 <b>/.test(x));
  assert.equal(mattino.length, 2, "due orti con piante: due messaggi del mattino");
  assert.ok(mattino.some((x) => x.startsWith("🪴 <b>Castrocaro Terme —") && x.includes("Zucchine") && !x.includes("Basilico")));
  assert.ok(mattino.some((x) => x.startsWith("🪴 <b>Mare —") && x.includes("Basilico") && x.includes("Rimini")));
  const t2 = await st.get("t-" + C2, { type: "json" });
  assert.ok(t2.notificati[t2.ultimo_invio].some((n) => n.id === "bas"), "le piante di tutti gli orti nel promemoria della sera");
  // pioggia misurata ARPAE: una per orto (Rimini ha la sua stazione)
  const C = await import("../netlify/lib/core.mjs"), ieri = new Date(Date.now() - 864e5).toISOString().slice(0, 10), righe = [];
  const giorno = (iso) => [...Array(27)].map((_, h) => new Date(Date.parse(iso + "T00:00:00Z") - 2 * 36e5 + h * 36e5).toISOString().replace(".000", ""));
  for (const t of giorno(ieri)) {
    righe.push(JSON.stringify({ network: "locali", lon: 1194940, lat: 4417012, date: t, data: [{ vars: { B01019: { v: "Castrocaro" } } }, { timerange: [1, 0, 3600], vars: { B13011: { v: 0.5 } } }] }));
    righe.push(JSON.stringify({ network: "locali", lon: 1256800, lat: 4406000, date: t, data: [{ vars: { B01019: { v: "Rimini" } } }, { timerange: [1, 0, 3600], vars: { B13011: { v: 1 } } }] }));
  }
  const vero = globalThis.fetch;
  globalThis.fetch = async (u, o) => String(u).includes("dati-simc.arpae.it") ? new Response(righe.join("\n")) : vero(u, o);
  try { await C.aggiornaPioggiaMisurata(st); } finally { globalThis.fetch = vero; }
  const d1 = (await call(dati, "/api/dati", { headers: H2 })).body.data;
  assert.equal(d1.pioggia_misurata.stazione, "Castrocaro"); assert.equal(d1.pioggia_orti.o1.stazione, "Rimini");
  assert.equal(M.vistaOrto(d1, "o1").pioggia_misurata.stazione, "Rimini");
  assert.equal((await call(dati, "/api/dati?op=pioggia&orto=o1", { headers: H2 })).body.stazione, "Rimini", "l'app chiede la pioggia dell'orto scelto");
  // l'app non può scrivere la pioggia misurata degli orti
  await call(dati, "/api/dati", { method: "POST", headers: H2, body: { changes: { pioggia_orti: {} } } });
  assert.equal((await call(dati, "/api/dati", { headers: H2 })).body.data.pioggia_orti.o1.stazione, "Rimini");
  // connettore: lo stesso, sui dati di prova principali con un secondo orto
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { orti: [{ id: "o1", nome: "Mare", location: { name: "Rimini", lat: 44.06, lon: 12.57 } }] } } });
  const g = (await strumento("giardino")).content[0].text;
  assert.match(g, /## Orto «Castrocaro Terme» \[orto p\]/); assert.match(g, /## Orto «Mare» \[orto o1\] · Rimini/);
  assert.match((await strumento("modifica_pianta", { azione: "modifica", pianta: "bas", campi: { orto: "boh" } })).content[0].text, /orto sconosciuto/);
  await strumento("modifica_pianta", { azione: "modifica", pianta: "bas", campi: { orto: "o1" } });
  assert.equal((await leggiDati()).plants.find((p) => p.id === "bas").orto, "o1");
  assert.match((await strumento("pianta", { pianta: "bas" })).content[0].text, /^# Basilico · orto «Mare» \(Rimini\)/);
  await strumento("modifica_pianta", { azione: "modifica", pianta: "bas", campi: { orto: "" } });
  assert.equal((await leggiDati()).plants.find((p) => p.id === "bas").orto, undefined);
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { orti: [] } } });
});

test("connettore: «diario» mostra la stessa correzione del consumo usata dal calcolo («giardino»)", async () => {
  const C = await import("../netlify/lib/core.mjs"), d = await leggiDati(), oggi = M.isoDate(new Date());
  const met = await C.meteo(d.location.lat, d.location.lon), testo = (await strumento("diario", { giorni: 30 })).content[0].text;
  let diverse = 0;
  for (const p of M.vistaOrto(d, "p").plants) {
    const vera = C.calibrazioneVera(M.vistaOrto(d, "p"), met, p.id, oggi), riga = testo.split("\n").find((l) => l.startsWith("- " + p.nome + ":"));
    assert.ok(riga, "nel diario c'è " + p.nome);
    assert.equal(riga.split("correzione ×")[1], String(Math.round(vera * 100) / 100).replace(".", ","), p.nome);
    if (Math.abs(vera - regolaSemplice(d.eventi, p.id, oggi)) > 0.005) diverse++;
  }
  assert.ok(diverse > 0, "almeno una pianta dove la regola semplice darebbe un altro numero");
});
// la regola semplice di prima (±10–24% per risposta), senza la stima del bilancio
function regolaSemplice(eventi, pid, oggi) {
  let f = 1, verso = 0, serie = 0;
  for (const e of M.eventiValidi(eventi, pid).filter((e) => { const g = M.giorniTra(e.data, oggi); return g >= 0 && g <= 60; }).sort((a, b) => (a.data < b.data ? -1 : 1))) {
    const v = e.tipo === "umido" || e.tipo === "meno" ? -1 : e.tipo === "piu" ? 1 : 0; if (!v) continue;
    serie = v === verso ? serie + 1 : 1; verso = v; f *= v < 0 ? 1 - 0.1 * (1 + 0.5 * Math.min(serie - 1, 2)) : 1 + 0.12 * (1 + 0.5 * Math.min(serie - 1, 2));
  }
  return Math.max(0.4, Math.min(2.5, f));
}

test("piante pianta per pianta: aggiunte, cambiate, tolte, ordine; le altre restano; l'elenco intero delle app vecchie vale ancora", async () => {
  const C3 = "GRD-PIANTE-PERPIANTA-ABCDEFGH", H3 = { "x-giardino-code": C3 }, nomi = async () => (await call(dati, "/api/dati", { headers: H3 })).body.data.plants.map((p) => p.id + (p.note ? ":" + p.note : ""));
  const P = (id, extra = {}) => ({ id, nome: id, specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 3, luce: 6, dove: "aperto", ...extra });
  await call(dati, "/api/dati", { method: "POST", headers: H3, body: { changes: { plants: [P("a"), P("b"), P("c")] } } });
  // intanto Claude aggiunge «z» (l'app non lo sa)
  await (await import("../netlify/lib/core.mjs")).aggiorna(getStore({ name: "giardino" }), C3, (d) => { d.plants.push(P("z")); });
  // l'app: cambia «a», toglie «b», aggiunge «n», mette «c» per prima
  await call(dati, "/api/dati", { method: "POST", headers: H3, body: { changes: {}, add: [], remove: [], piante: { set: [P("a", { note: "nuova" }), P("n")], del: ["b"], ordine: ["c", "a", "n"] } } });
  assert.deepEqual(await nomi(), ["c", "a:nuova", "n", "z"], "tolta b, cambiata a, aggiunta n, ordine dell'app; z di Claude resta in fondo");
  // una pianta che nello stesso gruppo è sia cambiata sia tolta: resta tolta
  await call(dati, "/api/dati", { method: "POST", headers: H3, body: { piante: { set: [P("n", { note: "x" })], del: ["n"] } } });
  assert.deepEqual(await nomi(), ["c", "a:nuova", "z"]);
  // app vecchia: l'elenco intero sostituisce ancora tutto
  await call(dati, "/api/dati", { method: "POST", headers: H3, body: { changes: { plants: [P("a")] } } });
  assert.deepEqual(await nomi(), ["a"]);
});

test("pioggia prevista contro misurata sul server: registro una volta al giorno fuori dai dati, pesi nei dati solo quando cambiano", async () => {
  const C = await import("../netlify/lib/core.mjs"), st = getStore({ name: "giardino" }), C4 = "GRD-PESIPIOGGIA-ABCDEFGHJK", lat = 44.21, lon = 12.04;
  const MOD = ["italia_meteo_arpae_icon_2i", "gfs_seamless", "ecmwf_ifs"], oggi = C.oraLocale("Europe/Rome").oggi;
  const log = {}, giorni = {};
  for (let i = 40; i >= 1; i--) { const d = M.addDays(oggi, -i), vero = i % 2 ? 0 : 5; giorni[d] = vero; log[d] = {}; for (const L of [0, 1, 2, 3]) log[d][L] = { [MOD[0]]: vero, [MOD[1]]: vero ? 14 : 3, [MOD[2]]: vero * 0.7 }; }
  await st.setJSON(`c-prev-${lat.toFixed(2)},${lon.toFixed(2)}`, { giorno: M.addDays(oggi, -1), log });
  const days = [0, 1, 2, 3, 4].map((i) => ({ date: M.addDays(oggi, i), ensemble: true, modelli: MOD, rain_modelli: [2, 9, 1.4], rain: 4, prob: 50, tmin: 8, tmax: 15, et0: 1 }));
  await st.setJSON(`c-meteo-${lat.toFixed(2)},${lon.toFixed(2)}`, { at: Date.now(), met: { tz: "Europe/Rome", lat, days, notte: [], suolo: null } });
  await call(dati, "/api/dati", { method: "POST", headers: { "x-giardino-code": C4 }, body: { changes: { location: { name: "Forlì", lat, lon }, plants: [PIANTE[0]] } } });
  await C.aggiorna(st, C4, (d) => { d.pioggia_misurata = { stazione: "Forlì", km: 1, giorni }; });
  const rev = async () => (await C.leggi(st, C4)).rev;
  const r0 = await rev();
  await C.previsioniPioggia(st, C4, { id: "p" }, { lat, lon });
  const d1 = (await C.leggi(st, C4)).data, r1 = await rev();
  assert.equal(d1.pesi_pioggia.p.pronti, true, "pesi imparati dai giorni registrati");
  assert.ok(d1.pesi_pioggia.p.pesi["1"].italia_meteo_arpae_icon_2i > d1.pesi_pioggia.p.pesi["1"].gfs_seamless);
  assert.equal(r1, r0 + 1, "una scrittura nei dati");
  const reg = await st.get(`c-prev-${lat.toFixed(2)},${lon.toFixed(2)}`, { type: "json" });
  assert.equal(reg.giorno, oggi); assert.deepEqual(Object.keys(reg.log[oggi]), ["0"]); assert.ok(reg.log[M.addDays(oggi, 3)]["3"], "oggi e i 3 giorni dopo");
  assert.ok(!("log" in d1) && !JSON.stringify(d1).includes('"c-prev'), "il registro non è nei dati dell'app");
  // seconda corsa nello stesso giorno: niente di nuovo, nessuna scrittura (i telefoni non riscaricano)
  days[0].rain_modelli = [30, 30, 30]; await st.setJSON(`c-meteo-${lat.toFixed(2)},${lon.toFixed(2)}`, { at: Date.now(), met: { tz: "Europe/Rome", lat, days, notte: [], suolo: null } });
  await C.previsioniPioggia(st, C4, { id: "p" }, { lat, lon });
  assert.equal(await rev(), r1, "pesi uguali: dati non toccati");
  assert.equal((await st.get(`c-prev-${lat.toFixed(2)},${lon.toFixed(2)}`, { type: "json" })).log[oggi]["0"].gfs_seamless, 9, "la previsione del mattino non si sovrascrive");
  // il piano usa la pioggia ripesata
  const v = M.vistaOrto(d1, "p"), met = await C.meteo(lat, lon), ap = C.pianoAttivo(v, met, oggi);
  assert.ok(ap.fut[1].ripesata && ap.fut[1].rain < 4, "pioggia di domani dai modelli che qui sbagliano meno: " + ap.fut[1].rain);
});

test("richieste insieme invece che in fila: il meteo di più orti, e su Telegram la conferma con i pulsanti nuovi", async () => {
  const C = await import("../netlify/lib/core.mjs"), vero = globalThis.fetch;
  // quante richieste sono aperte nello stesso momento (ognuna dura 40 ms)
  let aperte = 0, massimo = 0; const viste = [];
  const conta = (quali) => { aperte = 0; massimo = 0; viste.length = 0;
    globalThis.fetch = async (u, o) => { if (!quali(String(u))) return vero(u, o); viste.push(String(u).split("/").pop().split("?")[0]); massimo = Math.max(massimo, ++aperte); await new Promise((ok) => setTimeout(ok, 40)); aperte--; return vero(u, o); }; };
  try {
    // due orti in due città nuove (niente nell'archivio): le previsioni di base partono insieme
    conta((u) => u.includes("api.open-meteo.com") && u.includes("past_days=3"));
    const lista = await C.pianiOrti({ location: { name: "Trento", lat: 46.07, lon: 11.12 }, orti: [{ id: "o1", nome: "Lago", location: { name: "Como", lat: 45.81, lon: 9.08 } }],
      plants: [{ ...PIANTE[0] }, { ...PIANTE[1], orto: "o1" }], eventi: [], impostazioni: {} });
    assert.deepEqual(lista.map((x) => x.v.orto.id), ["p", "o1"], "nello stesso ordine degli orti");
    assert.deepEqual(lista.map((x) => x.ap.piano.piante.map((p) => p.id)), [["zuc"], ["bas"]], "ogni orto con il piano delle sue piante");
    assert.equal(massimo, 2, "il meteo dei due orti chiesto insieme");
    // pulsante su Telegram: «Registrato» e i pulsanti nuovi partono insieme, e arrivano tutti e due
    conta((u) => u.includes("api.telegram.org"));
    const kb = [[{ text: "✅ Annaffiato", callback_data: `g|${OGGI}|pom|f` }], [{ text: "💦 Terreno ancora umido", callback_data: `g|${OGGI}|pom|u` }]];
    inviati.length = 0;
    await webhook({ callback_query: { id: "cbpar", data: `g|${OGGI}|pom|u`, message: { message_id: 21, chat: { id: 77 }, reply_markup: { inline_keyboard: kb } } } });
    assert.deepEqual(viste, ["answerCallbackQuery", "editMessageReplyMarkup"], "prima parte la conferma, poi i pulsanti");
    assert.equal(massimo, 2, "senza aspettare la risposta alla prima");
    assert.match(inviati.find((x) => x[0] === "answerCallbackQuery")[1].text, /Registrato: Pomodoro/);
    assert.ok(["innaffia", "controlla"].includes((await leggiDati()).eventi.find((e) => e.id === "tg-cbpar").previsto), "la risposta ricorda cosa diceva il piano");
    assert.match(JSON.stringify(inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup), /Annulla/);
    // annullo, per lasciare i dati com'erano
    await webhook({ callback_query: { id: "cbpar2", data: `g|${OGGI}|pom|zn`, message: { message_id: 21, chat: { id: 77 }, reply_markup: { inline_keyboard: inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup.inline_keyboard } } } });
    assert.equal(massimo, 2);
  } finally { globalThis.fetch = vero; }
});

test("acqua di tutta la vita sul server: inizio scritto una volta, diario potato riportato nella pianta, un'app vecchia non toglie niente, bot e connettore", async () => {
  const { rinnovaPioggia } = await import("../netlify/lib/core.mjs");
  const st = getStore({ name: "giardino" }), d0 = await leggiDati(), g = (n) => M.addDays(OGGI, n);
  const posta = (body) => call(dati, "/api/dati", { method: "POST", headers: H, body });
  // le piante di prima ricevono l'inizio al primo salvataggio (la prima traccia nel diario o nella pianta)
  assert.ok(d0.plants.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.aggiunta)), "ogni pianta ha il suo inizio");
  const vec = { id: "vec", nome: "Rosa vecchia", specie: "rosa", fase: "auto", colt: "vaso", vaso: 20, diametro: 35, num: 1, luce: 6, dove: "aperto", aggiunta: g(-500) };
  await posta({ changes: { plants: [...d0.plants, vec] }, add: [{ id: "v1", plantId: "vec", tipo: "fatto", data: g(-450), litri: 2 }, { id: "v2", plantId: "vec", tipo: "fatto", data: g(-10), litri: 1 }] });
  const d1 = await leggiDati(), p1 = d1.plants.find((p) => p.id === "vec");
  assert.ok(!d1.eventi.some((e) => e.id === "v1") && d1.eventi.some((e) => e.id === "v2"), "oltre 400 giorni: fuori dal diario");
  assert.deepEqual(p1.vita_vecchia, { litri: 2, volte: 1, senzaLitri: 0, presa: 0 }, "ma resta contata nella pianta");
  assert.equal(M.acquaVita(p1, d1.eventi, [], OGGI, 44).innaffiature.litri, 3);
  // il bot: la pioggia dei giorni che stanno per uscire dall'archivio del meteo resta contata nella pianta
  const archivio = {}; for (let i = 400; i >= 1; i--) archivio[g(-i)] = [5, 15, i === 380 ? 12 : 0, 1, 0.5, 5];
  const data = await rinnovaPioggia(st, CODE, d1, OGGI, async () => ({ days: [], archivio, lat: 44.176 }));
  const pv = data.plants.find((p) => p.id === "vec").pioggia_vita;
  assert.equal(pv.fino, g(-300)); assert.ok(pv.litri > 0 && pv.dal === g(-500), JSON.stringify(pv));
  assert.equal((await rinnovaPioggia(st, CODE, await leggiDati(), OGGI, async () => { throw new Error("non serve"); })).plants.length, data.plants.length, "fatto: per altri 50 giorni non richiede il meteo");
  // un'app rimasta indietro manda la pianta senza questi campi: restano quelli del server
  await posta({ changes: { plants: [...d0.plants, { ...vec, aggiunta: g(-2), note: "x" }] } });
  const p2 = (await leggiDati()).plants.find((p) => p.id === "vec");
  assert.equal(p2.note, "x"); assert.equal(p2.aggiunta, g(-500), "l'inizio resta il più vecchio");
  assert.deepEqual([p2.vita_vecchia, p2.pioggia_vita], [p1.vita_vecchia, pv]);
  // connettore: la riga dell'acqua di tutta la vita; al riparo, la pioggia fino a ieri resta quella di prima
  const totale = async () => { const t = (await strumento("pianta", { pianta: "vec" })).content[0].text;
    assert.match(t, /acqua ricevuta in tutta la vita \(da quando è nell'app, dal \d{4}-\d{2}-\d{2}\): [\d,]+ L, di cui innaffiature 3 L \(2 volte\) e pioggia [\d,]+ L arrivata al terriccio/);
    return t.match(/in tutta la vita [^:]+: ([\d,]+) L/)[1]; };
  const prima = await totale();
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "vec", campi: { dove: "riparato" } })).isError, false);
  const p3 = (await leggiDati()).plants.find((p) => p.id === "vec");
  assert.equal(p3.dove, "riparato"); assert.equal(p3.pioggia_vita.fino, g(-1)); assert.ok(p3.pioggia_vita.litri >= pv.litri);
  assert.equal(await totale(), prima, "al riparo il totale non cambia: la pioggia di prima resta");
  // fermata con l'archivio corto (qui solo gli ultimi giorni): i giorni senza meteo restano segnati e il bot li riempie
  assert.ok(p3.pioggia_vita.buchi?.some((b) => b.da === g(-299) && b.a === g(-4)), JSON.stringify(p3.pioggia_vita.buchi));
  archivio[g(-100)][2] = 20;
  const p4 = (await rinnovaPioggia(st, CODE, await leggiDati(), OGGI, async () => ({ days: [], archivio, lat: 44.176 }))).plants.find((p) => p.id === "vec");
  assert.ok(p4.pioggia_vita.litri > p3.pioggia_vita.litri && p4.pioggia_vita.fino === p3.pioggia_vita.fino, "riempito con la pioggia di quei giorni");
  assert.deepEqual(p4.pioggia_vita.buchi.map((b) => [b.da, b.a]), [[g(-500), g(-401)]], "resta solo quello più vecchio dell'archivio");
  // pianta nuova dal connettore: inizio oggi
  assert.equal((await strumento("modifica_pianta", { azione: "aggiungi", campi: { nome: "Prova nuova" } })).isError, false);
  assert.equal((await leggiDati()).plants.find((p) => p.nome === "Prova nuova").aggiunta, oraLocaleRoma());
  // pulizia
  await posta({ changes: { plants: d0.plants }, remove: ["v2"] });
  assert.ok(!(await leggiDati()).eventi.some((e) => e.plantId === "vec"));
});
const oraLocaleRoma = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());

test("Telegram: «Annaffiato» registra i litri scritti nel messaggio, e «Annulla» rimette il pulsante uguale", async () => {
  const { pulsantiAcqua } = await import("../netlify/lib/core.mjs");
  const d0 = await leggiDati(), tlp = { id: "tlp", nome: "Prova litri", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 5, num: 1, luce: 6, dove: "aperto" };
  const kb = pulsantiAcqua(tlp, OGGI, { conNome: false, litri: 0.734 });
  assert.equal(kb[0][0].callback_data, `g|${OGGI}|tlp|f|0.73`, "la dose del messaggio viaggia nel pulsante");
  assert.ok(!pulsantiAcqua(tlp, OGGI, { secca: true, litri: 0.7 })[0][0].callback_data.includes("0.7"), "«Era secca» no: la dose la calcola il server");
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: [...d0.plants, tlp] } } });
  inviati.length = 0;
  await webhook({ callback_query: { id: "cbl", data: kb[0][0].callback_data, message: { message_id: 13, chat: { id: 77 }, reply_markup: { inline_keyboard: kb } } } });
  assert.equal((await leggiDati()).eventi.find((e) => e.id === "tg-cbl")?.litri, 0.73, "registrati i litri che hai letto (prima: la dose ricalcolata)");
  const annullaB = inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup.inline_keyboard.flat().find((b) => b.text === "↩️ Annulla");
  assert.ok(annullaB.callback_data.length <= 64);
  inviati.length = 0;
  await webhook({ callback_query: { id: "cbl2", data: annullaB.callback_data, message: { message_id: 13, chat: { id: 77 }, reply_markup: { inline_keyboard: [[{ text: "x", callback_data: annullaB.callback_data }]] } } } });
  assert.ok(!(await leggiDati()).eventi.some((e) => e.id === "tg-cbl"), "risposta tolta");
  assert.deepEqual(inviati.find((x) => x[0] === "editMessageReplyMarkup")[1].reply_markup.inline_keyboard, kb, "pulsanti di prima, con i litri");
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: d0.plants } } });
});

test("connettore: giardino in breve e per orto, avviso del meteo vecchio, diario per pianta e per mese, inizio dell'acqua modificabile, registra con l'effetto", async () => {
  const st = getStore({ name: "giardino" }), d0 = await leggiDati();
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  const testo = async (n, a = {}) => { const r = await strumento(n, a); return { err: r.isError, t: r.content[0].text }; };
  // in breve: molto più corto, una riga per pianta con l'azione di oggi
  const pieno = (await testo("giardino")).t, breve = (await testo("giardino", { compatto: true })).t;
  assert.ok(breve.length < pieno.length / 3, `breve ${breve.length} contro ${pieno.length} caratteri`);
  for (const p of d0.plants.filter((p) => !p.orto)) assert.match(breve, new RegExp(`\\*\\*${p.nome}\\*\\* \\[${p.id}\\][^\\n]*: oggi `));
  assert.match(breve, /^Meteo: /m);
  assert.ok((await testo("giardino", { orto: "boh-non-esiste" })).err, "orto sconosciuto");
  // meteo vecchio (niente previsioni per oggi): avviso in testa, prima di tutto
  const loc = d0.location, key = `c-meteo-${(+loc.lat).toFixed(2)},${(+loc.lon).toFixed(2)}`, c0 = await st.get(key, { type: "json" });
  await st.setJSON(key, { at: Date.now(), met: { ...c0.met, days: c0.met.days.filter((d) => d.date < OGGI) } });
  const vecchio = (await testo("giardino", { compatto: true })).t;
  assert.match(vecchio.split("\n")[1], /⚠️ Meteo vecchio: niente previsioni per oggi/);
  await st.setJSON(key, c0);
  assert.ok(!/⚠️/.test((await testo("giardino", { compatto: true })).t.split("\n")[1] || ""), "col meteo buono nessun avviso");
  // diario di una pianta sola, con i litri per mese
  const pid = d0.plants.find((p) => d0.eventi.some((e) => e.plantId === p.id && (e.tipo === "fatto" || e.tipo === "secco"))).id, nome = d0.plants.find((p) => p.id === pid).nome;
  const dia = (await testo("diario", { pianta: pid, giorni: 400 })).t;
  assert.match(dia, new RegExp(`^# Diario degli ultimi 400 giorni · ${nome}`)); assert.match(dia, /## Per mese \(innaffiature\)\n- \d{4}-\d{2}: [\d,]+ L in \d+ volt/);
  assert.equal(dia.split("\n").filter((r) => /^- .*: \d+ innaffiature/.test(r)).length, 1, "riepilogo solo di quella pianta");
  // inizio dell'acqua di tutta la vita: Claude lo corregge se l'utente dice che è sbagliato (mai nel futuro)
  assert.equal((await testo("modifica_pianta", { azione: "modifica", pianta: pid, campi: { aggiunta: "2026-01-10" } })).err, false);
  assert.equal((await leggiDati()).plants.find((p) => p.id === pid).aggiunta, "2026-01-10");
  assert.ok((await testo("modifica_pianta", { azione: "modifica", pianta: pid, campi: { aggiunta: "2099-01-01" } })).err);
  // registra: risponde con l'effetto sul calcolo
  const r = (await testo("registra", { pianta: pid, tipo: "umido" })).t;
  assert.match(r, /Correzione appresa .* Adesso: acqua nel terriccio ~\d+% \(sotto \d+% si innaffia\); /);
  // pulizia
  const ev = (await leggiDati()).eventi.find((e) => e.fonte === "claude" && e.plantId === pid && e.tipo === "umido" && e.data === OGGI);
  if (ev) await strumento("annulla", { id: ev.id });
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: d0.plants } } });
});

test("orari delle notifiche: ognuna alla sua ora, quelle fatte non si ripetono, i dati di prima valgono, Claude le cambia", async () => {
  const st = getStore({ name: "giardino" }), t0 = await st.get("t-" + CODE, { type: "json" }), d0 = await leggiDati();
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);   // lì adesso sono le 12
  const orp = { id: "orp", nome: "Prova orari", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 5, num: 1, luce: 6, dove: "aperto" };
  const piano = { createdAt: new Date().toISOString(), source: "claude", data: { sintesi: "", avvisi: [], piante: [{ id: "orp", giorni: [{ data: OGGI, azione: "innaffia", litri: 0.4, momento: "mattina presto", motivo: "prova" }] }] } };
  const imp = (orari) => ({ bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12, orari });
  // il bot salva il fuso del meteo (finto: UTC): prima di ogni giro rimetto quello in cui sono le 12
  const giro = async () => { const x = await st.get("t-" + CODE, { type: "json" }); await st.setJSON("t-" + CODE, { ...x, tz }); inviati.length = 0; await bot(); return inviati.filter((x) => x[0] === "sendMessage").map((x) => x[1].text); };
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: [...d0.plants, orp], piano_claude: piano, vacanza: null, impostazioni: imp({ sera: 13, controllo: 13, avvisi: 13, riepilogo: 13, piano: 13, backup: 13 }) } } });
  await st.setJSON("t-" + CODE, { ...t0, tz, inviati_il: {}, segnati_il: null, ultimo_invio: null, ultimo_avviso_sera: null, notificati: {}, ultimo_backup: null, lavori_il: null });
  // alle 12: il mattino (ora 7) sì, il promemoria della sera (ora 13) non ancora
  let testi = await giro();
  assert.ok(testi.some((x) => x.includes("Giardino —") && x.includes("Prova orari")), "piano del mattino");
  assert.ok(!testi.some((x) => x.includes("Ancora da innaffiare")) && !inviati.some((x) => x[0] === "sendDocument"), "niente notifiche delle 13");
  let t = await st.get("t-" + CODE, { type: "json" });
  assert.equal(t.inviati_il.mattina, OGGI); assert.ok(!t.inviati_il.sera); assert.ok(t.notificati[OGGI].some((n) => n.id === "orp"), "la pianta di oggi è segnata per la sera");
  // anticipo il promemoria alle 12: arriva al giro dopo, il mattino non si ripete
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: imp({ sera: 12, controllo: 13, avvisi: 13, riepilogo: 13, piano: 13, backup: 13 }) } } });
  testi = await giro();
  assert.ok(testi.some((x) => x.includes("Ancora da innaffiare") && x.includes("Prova orari")), "promemoria alla sua ora");
  assert.ok(!testi.some((x) => x.includes("Giardino —")), "il mattino non si ripete");
  assert.equal((await giro()).length, 0, "una volta sola");
  // i dati di prima (solo ultimo_invio e ultimo_avviso_sera di oggi): niente messaggi doppi il giorno del passaggio
  t = await st.get("t-" + CODE, { type: "json" }); const { inviati_il, ...vecchio } = t;
  await st.setJSON("t-" + CODE, { ...vecchio, ultimo_invio: OGGI, ultimo_avviso_sera: OGGI });
  assert.equal((await giro()).length, 0, "con i dati di prima, mattino e sera già fatti");
  // dal connettore: Claude cambia l'ora di una notifica
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  assert.match((await strumento("impostazioni", { orari: { avvisi: 21 } })).content[0].text, /avvisi alle 21:00/);
  assert.equal((await leggiDati()).impostazioni.orari.avvisi, 21);
  assert.ok((await strumento("impostazioni", { orari: { boh: 9 } })).isError, "tipo sconosciuto");
  assert.ok((await strumento("impostazioni", { orari: { sera: 25 } })).isError);
  assert.match((await strumento("giardino")).content[0].text, /avvisi 21:00/);
  // pulizia
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { plants: d0.plants, piano_claude: d0.piano_claude, vacanza: d0.vacanza, impostazioni: d0.impostazioni } } });
  await st.setJSON("t-" + CODE, { ...t0 });
});

test("torre nell'app: aggiornata a pezzi (invariato o solo la coda), sempre uguale a scaricare tutto", async () => {
  const C5 = "GRD-PEZZITORRE-ABCDEFGHJK", H5 = { "x-giardino-code": C5 }, MT = await import("../netlify/lib/torre.mjs");
  const torreFn = (await import("../netlify/functions/torre.mjs")).default;
  let chiave = (await call(dati, "/api/dati?op=torre", { method: "POST", headers: H5, body: { action: "chiave" } })).body.torre.chiave;
  const manda = (misure, avvio = 1) => call(torreFn, "/api/torre", { method: "POST", headers: { "x-torre-chiave": chiave }, body: { v: 1, fw: 7, rev: 0, avvio, sec: 99999, stato: { modo: "normale", t: 12, u: 60 }, misure } });
  const adesso = Math.floor(Date.now() / 1000);
  const blocco = (da, n, passo = 600, avvio = 1) => Array.from({ length: n }, (_, i) => [da + i * passo, 10 + (i % 7), 60, i % 3 ? 0 : 300, 0, avvio, da + i]);
  let risposte = [];
  const leggi = async (q) => { const r = await call(dati, "/api/dati?op=torre&giorni=8" + q, { headers: H5 }); risposte.push(JSON.stringify(r.body).length); return r.body; };
  const chiedi = async (prima) => { const c = MT.cursoreTorre(prima); return MT.torreAggiornata(prima, await leggi(c ? `&u=${c.u}&da=${c.da}` : ""), 8, adesso); };
  const tutto = async () => MT.torreAggiornata(null, await leggi(""), 8, adesso);
  // 1. prima volta: tutto
  assert.equal((await manda(blocco(adesso - 3 * 86400, 144))).status, 200);
  let app = await chiedi(null);
  assert.deepEqual(app, await tutto()); assert.equal(app.misure.length, 144);
  // 2. niente di nuovo: «invariato», l'app tiene lo stesso oggetto
  risposte = []; assert.equal(await chiedi(app), app); assert.ok(risposte[0] < 40, "risposta minima: " + risposte[0]);
  // 3. arretrato in due blocchi con un aggiornamento in mezzo; poi misure fuori ordine (orologio rimesso indietro di 20 minuti)
  await manda(blocco(adesso - 2 * 86400, 144));
  app = await chiedi(app);
  await manda(blocco(adesso - 86400 - 1200, 100, 600, 2));
  risposte = []; app = await chiedi(app); assert.deepEqual(app, await tutto());
  assert.ok(risposte[0] < risposte[1] / 2, `solo la coda: ${risposte[0]} byte invece di ${risposte[1]}`);
  // 4. torre tolta e rifatta: la versione riparte, l'app ricarica tutto
  await call(dati, "/api/dati?op=torre", { method: "POST", headers: H5, body: { action: "togli" } });
  chiave = (await call(dati, "/api/dati?op=torre", { method: "POST", headers: H5, body: { action: "chiave" } })).body.torre.chiave;
  await manda(blocco(adesso - 3600, 6, 600, 9));
  app = await chiedi(app); assert.deepEqual(app, await tutto()); assert.equal(app.misure.length, 6);
  // 5. un'app vecchia (senza u e da) riceve tutto
  const vecchia = await leggi(""); assert.ok(!vecchia.parziale && vecchia.misure.length === 6);
});

test("torre idroponica: chiave, misure dall'ESP32 (anche senza ora), impostazioni e accensione una volta sola, avvisi su Telegram, spenta e tolta", async () => {
  const torreFn = (await import("../netlify/functions/torre.mjs")).default;
  const st = getStore({ name: "giardino" }), t0 = await st.get("t-" + CODE, { type: "json" }), d0 = await leggiDati();
  const manda = (chiave, body) => call(torreFn, "/api/torre", { method: "POST", headers: chiave ? { "x-torre-chiave": chiave } : {}, body });
  // attivazione dall'app: il server crea la torre e la chiave
  const r = (await call(dati, "/api/dati?op=torre", { method: "POST", headers: H, body: { action: "chiave" } })).body;
  const chiave = r.torre.chiave;
  assert.match(chiave, /^[A-Z2-7]{26}$/); assert.equal(r.torre.attiva, true); assert.equal(r.torre.posizione, "fuori");
  assert.equal((await manda("", { misure: [] })).status, 403); assert.equal((await manda("A".repeat(26), { misure: [] })).status, 403);
  // la torre manda misure: quelle della stessa accensione senza ora le data il server; le impostazioni arrivano (rev diverso)
  const adesso = Math.floor(Date.now() / 1000);
  const corpo = { v: 1, fw: 2, rev: 0, avvio: 3, sec: 7200, stato: { modo: "normale", pompa: false, t: 18.5, u: 60 },
    misure: [[null, 17.2, 62, 900, 0, 3, 600], [null, 1.5, 90, 0, 3, 3, 1200], [adesso - 300, 18.4, 61, 0, 0, 3, 6900], [null, 5, 50, 0, 0, 2, 100]] };
  const a = (await manda(chiave, corpo)).body;
  assert.equal(a.nuove, 3, "quella di un'accensione passata senza ora si scarta");
  assert.equal(a.config.rev, 1); assert.deepEqual(a.config.pause, [5, 10, 15, 25, 45, 60]); assert.equal(a.config.freddo_stop, 2);
  assert.equal(a.config.guasto_pausa, 20); assert.equal(a.config.guasto_ferma, false); assert.ok(Array.isArray(a.gelo), "ore di gelo sempre mandate (anche vuote)");
  const g = (await call(dati, "/api/dati?op=torre", { headers: H })).body;
  assert.equal(g.misure.length, 3); assert.ok(Math.abs(g.misure[0][0] - (adesso - 6600)) < 5, "datata con l'orologio del server");
  assert.deepEqual(g.misure[0].slice(1), [17.2, 62, 900, 0]); assert.equal(g.stato.t, 18.5);
  // stesso blocco rimandato (risposta persa): niente doppioni; con le impostazioni giuste non le rimanda
  const b = (await manda(chiave, { ...corpo, rev: 1 })).body;
  assert.equal(b.nuove, 0); assert.ok(!("config" in b));
  assert.equal((await call(dati, "/api/dati?op=torre", { headers: H })).body.misure.length, 3);
  // dall'app: impostazioni nuove e accensione a mano; la chiave resta quella del server anche se l'app non la manda
  const tr = (await leggiDati()).torre;
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { torre: { ...tr, chiave: "FALSA", posizione: "fuori", rev: 2, config: { ...tr.config, accesa_min: 10, pause: [4, 8, 12, 20, 40, 999] }, comando: { id: "c1", pompa_s: 60, at: new Date().toISOString() } } } } });
  const tr2 = (await leggiDati()).torre;
  assert.equal(tr2.chiave, chiave); assert.equal(tr2.config.accesa_min, 10); assert.equal(tr2.config.pause[5], 240, "limitata");
  const c = (await manda(chiave, { ...corpo, rev: 1, misure: [] })).body;
  assert.equal(c.config.rev, 2); assert.equal(c.config.accesa_min, 10); assert.deepEqual(c.comando, { pompa_s: 60, id: "c1" });
  assert.ok(!("comando" in (await manda(chiave, { ...corpo, rev: 2, misure: [] })).body), "l'accensione arriva una volta sola");
  // Telegram, la sera: torre fuori con stanotte 1 °C (meteo finto) e la pompa ferma per il freddo → avviso
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12 } } } });
  const giro = async () => { const x = await st.get("t-" + CODE, { type: "json" }); await st.setJSON("t-" + CODE, { ...x, tz, inviati_il: {}, segnati_il: null, ultimo_invio: null, ultimo_avviso_sera: null, ultimo_backup: new Date().toISOString().slice(0, 7) });
    inviati.length = 0; await bot(); return inviati.filter((x) => x[0] === "sendMessage" && /Torre idroponica/.test(x[1].text)).map((x) => x[1].text); };
  const [m] = await giro();
  assert.ok(m, "avviso della torre"); assert.match(m, /Stanotte fino a 1 °C: sotto 2 °C la pompa si ferma da sola/); assert.match(m, /ferma per il freddo/);
  // dal connettore: stato, storico e impostazioni; la chiave dell'ESP32 non esce mai
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  let tx = (await strumento("torre")).content[0].text;
  assert.match(tx, /Ultimo contatto/); assert.match(tx, /pompa accesa 10 min per ciclo/); assert.match(tx, /Ultime 24 ore: minima 1,5 °C/); assert.ok(!tx.includes(chiave), "niente chiave");
  assert.match((await strumento("torre", { storico: "misure", giorni: 31 })).content[0].text, /;17,2;62;900;normale\n.*;1,5;90;0;freddo: pompa ferma/);
  assert.match((await strumento("torre", { storico: "giorni" })).content[0].text, /giorno;minima °C \(ora\)/);
  assert.match((await strumento("torre", { storico: "ore", giorni: 2 })).content[0].text, /giorno ora;°C media/);
  assert.match((await strumento("giardino", { compatto: true })).content[0].text, /Torre idroponica \(fuori\): ultimo contatto/);
  tx = (await strumento("torre_imposta", { accesa_min: 12, pause: [3, 6, 10, 20, 40, 60], notte_fattore: 3 })).content[0].text;
  assert.match(tx, /versione 3/); assert.match(tx, /pompa accesa per ciclo \(min\): 10 → 12/);
  assert.equal((await leggiDati()).torre.config.accesa_min, 12); assert.equal((await leggiDati()).torre.chiave, chiave);
  assert.ok((await strumento("torre_imposta", { freddo_stop: 20 })).isError, "fuori dai limiti");
  assert.ok((await strumento("torre_imposta", { soglie: [30, 31, 20, 12, 5] })).isError, "soglie in ordine");
  assert.ok((await strumento("torre_imposta", { freddo_stop: 3, freddo_riparte: 3.5 })).isError, "riparte almeno 1 °C sopra");
  assert.equal((await leggiDati()).torre.rev, 3, "gli errori non salvano niente");
  assert.match((await strumento("torre_imposta", { pompa_s: 30 })).content[0].text, /accensione a mano per 30 s/);
  const cm = (await manda(chiave, { ...corpo, rev: 2, misure: [] })).body;
  assert.equal(cm.config.accesa_min, 12); assert.equal(cm.comando.pompa_s, 30);
  assert.match((await strumento("torre_imposta", { accesa_min: 12 })).content[0].text, /Niente da cambiare/);
  assert.match((await strumento("torre_imposta", { guasto_pausa: 30, guasto_ferma: true })).content[0].text, /pompa ferma: no → sì/);
  assert.match((await strumento("torre_imposta", { cal_t: -2 })).content[0].text, /correzione del termometro \(°C\): 0 → -2/);
  assert.match((await strumento("torre")).content[0].text, /correzione del termometro: -2 °C/);
  assert.equal((await leggiDati()).torre.config.guasto_pausa, 30);
  assert.ok((await strumento("torre_imposta", { guasto_ferma: "sì" })).isError);
  tx = (await strumento("torre_imposta", { capacita: 20, nutrienti_ogni: 10, segna: "rabbocco", litri: 4 })).content[0].text;
  assert.match(tx, /serbatoio: – → 20 L/); assert.match(tx, /rabbocco segnato \(4 L\)/); assert.doesNotMatch(tx, /L'ESP32 le riceve/, "non riguarda l'ESP32");
  assert.deepEqual([(await leggiDati()).torre.serbatoio.capacita, (await leggiDati()).torre.lavori.nutrienti.ogni, (await leggiDati()).torre.serbatoio.rabbocchi.at(-1).litri], [20, 10, 4]);
  assert.match((await strumento("torre_imposta", { segna: "pulizia", quando: "2020-01-01" })).content[0].text, /ultimi 60 giorni/);
  tx = (await strumento("torre")).content[0].text;
  assert.match(tx, /## Serbatoio e manutenzione/); assert.match(tx, /serbatoio 20 L, minimo per la pompa 5 L: ultimo rabbocco oggi; beve circa .* L al giorno .*stima prudente .*restano circa 20 L/);
  tx = (await strumento("torre_imposta", { minimo: 4, anticipo: 2 })).content[0].text;
  assert.match(tx, /livello minimo per la pompa: un quarto → 4 L/); assert.match(tx, /avviso del serbatoio: 3 → 2 giorni prima/); assert.doesNotMatch(tx, /L'ESP32 le riceve/);
  assert.deepEqual([(await leggiDati()).torre.serbatoio.minimo, (await leggiDati()).torre.serbatoio.anticipo], [4, 2]);
  assert.ok((await strumento("torre_imposta", { anticipo: 30 })).isError);
  tx = (await strumento("torre")).content[0].text; assert.match(tx, /nutrienti: mai segnato \(ogni 10 giorni\)/);
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: false } });
  assert.ok((await strumento("torre_imposta", { accesa_min: 11 })).isError, "senza permesso");
  assert.ok(!(await strumento("torre")).isError, "leggere si può sempre");
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  // avvisi urgenti subito su Telegram (sensore guasto, riavvio per calo di tensione), una volta; riassunti per giorno e riavvii all'app
  const urgenti = () => inviati.filter((x) => x[0] === "sendMessage" && /Torre idroponica/.test(x[1].text)).map((x) => x[1].text).join("\n");
  inviati.length = 0;
  await manda(chiave, { ...corpo, avvio: 4, sec: 100, stato: { modo: "senza sensore", pompa: false, riavvio: "tensione" }, misure: [[null, null, null, 0, 4, 4, 90]] });
  assert.match(urgenti(), /sensore della torre non risponde/); assert.match(urgenti(), /riavviata per calo di tensione/);
  inviati.length = 0;
  await manda(chiave, { ...corpo, avvio: 4, sec: 200, stato: { modo: "senza sensore", riavvio: "tensione" }, misure: [[null, null, null, 0, 4, 4, 190]] });
  assert.equal(urgenti(), "", "lo stesso avviso non si ripete subito");
  const gt = (await call(dati, "/api/dati?op=torre", { headers: H })).body;
  assert.ok(gt.giorni.length >= 1 && gt.giorni.at(-1).length === 8); assert.equal(gt.riavvii.at(-1).motivo, "tensione");
  const tr3 = (await leggiDati()).torre;
  // spenta: niente avvisi (l'app è come se non ci fosse), la torre può mandare lo stesso
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { torre: { ...tr3, attiva: false } } } });
  assert.equal((await giro()).length, 0, "spenta: nessun messaggio");
  assert.equal((await manda(chiave, { ...corpo, misure: [] })).status, 200);
  // nuova chiave: la vecchia non vale più; tolta: via tutto
  const nuova = (await call(dati, "/api/dati?op=torre", { method: "POST", headers: H, body: { action: "chiave" } })).body.torre.chiave;
  assert.notEqual(nuova, chiave); assert.equal((await manda(chiave, corpo)).status, 403); assert.equal((await manda(nuova, { ...corpo, misure: [] })).status, 200);
  await call(dati, "/api/dati?op=torre", { method: "POST", headers: H, body: { action: "togli" } });
  assert.ok(!(await leggiDati()).torre); assert.equal((await manda(nuova, corpo)).status, 403);
  assert.equal((await call(dati, "/api/dati?op=torre", { headers: H })).body.misure.length, 0);
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: d0.impostazioni } } });
  await st.setJSON("t-" + CODE, { ...t0 });
});
