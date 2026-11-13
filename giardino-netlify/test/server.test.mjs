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
  // crediti veri letti su Netlify: la stima riparte da lì
  const cor = (await call(dati, "/api/dati?op=crediti", { method: "POST", headers: H, body: { rimasti: 104 } })).body;
  assert.equal(cor.stima, 196); assert.equal(cor.corretta.rimasti, 104);
  assert.equal((await call(dati, "/api/dati?op=crediti", { method: "POST", headers: H, body: { rimasti: 999 } })).status, 400);
  { const g = getStore({ name: "giardino" }), k = "u-" + new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(new Date());
    const u = await g.get(k, { type: "json" }); delete u.correzione; await g.setJSON(k, u); }   // le prove dopo contano le pubblicazioni
  assert.deepEqual(st.mcp, { active: false }); assert.deepEqual(st.telegram, { configured: false }); assert.ok(st.crediti.limite === 300 && !("key" in st.crediti));
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
  assert.equal((await rpc("tools/list")).result.tools.length, 12);
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
  await st.setJSON("t-" + CODE, { ...t, tz, ultimo_invio: null, ultimo_avviso_sera: null, ultimo_backup: new Date().toISOString().slice(0, 7) });
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
  await st.setJSON("t-" + CODE, { ...t1, tz, ultimo_invio: null, ultimo_avviso_sera: null });
  inviati.length = 0; await Promise.all([bot(), bot()]);
  assert.equal(inviati.filter((x) => x[0] === "sendMessage" && x[1].text.includes("Giardino —")).length, 1, "mattino una volta sola");
  assert.equal(inviati.filter((x) => x[0] === "sendMessage" && x[1].text.includes("Ancora da innaffiare")).length, 1, "sera una volta sola");
});

test("notifiche spente in Impostazioni: il bot non le manda (il promemoria della sera sì, anche senza mattino)", async () => {
  const st = getStore({ name: "giardino" }), t0 = await st.get("t-" + CODE, { type: "json" });
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12);
  const giro = async (notifiche) => {
    const t = await st.get("t-" + CODE, { type: "json" });
    await st.setJSON("t-" + CODE, { ...t, tz, ultimo_invio: null, ultimo_avviso_sera: null, ultimo_backup: null, notificati: {} });
    await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12, notifiche } } } });
    inviati.length = 0; await bot();
    const testi = inviati.filter((x) => x[0] === "sendMessage").map((x) => x[1].text);
    return { mattino: testi.some((x) => x.includes("Giardino —")), sera: testi.some((x) => x.includes("Ancora da innaffiare")), backup: inviati.some((x) => x[0] === "sendDocument"), n: testi.length };
  };
  const tutte = await giro({});
  assert.ok(tutte.mattino && tutte.sera, "con tutto acceso: mattino e sera");
  const senzaMattino = await giro({ mattina: false, backup: false });
  assert.ok(!senzaMattino.mattino, "mattino spento"); assert.ok(senzaMattino.sera, "la sera arriva lo stesso, con le piante di oggi"); assert.ok(!senzaMattino.backup, "backup spento");
  const nessuna = await giro(Object.fromEntries(["mattina", "sera", "avvisi", "verifica", "riepilogo", "backup", "piano", "crediti"].map((k) => [k, false])));
  assert.equal(nessuna.n, 0, "tutto spento: nessun messaggio"); assert.ok(!nessuna.backup);
  const t = await st.get("t-" + CODE, { type: "json" }), oggi = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  assert.equal(t.ultimo_invio, oggi); assert.equal(t.ultimo_avviso_sera, oggi); assert.deepEqual(t.notificati, {}, "nessuna pianta segnata: domani niente innaffiature presunte");
  // dal connettore: Claude riaccende il mattino e spegne il riepilogo; le altre restano come sono
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: true } });
  const r = await strumento("impostazioni", { notifiche: { mattina: true, riepilogo: false } });
  assert.match(r.content[0].text, /notifica mattina accesa.*notifica riepilogo spenta/);
  const n = (await leggiDati()).impostazioni.notifiche;
  assert.ok(!("mattina" in n) && n.riepilogo === false && n.sera === false && n.crediti === false);
  assert.ok((await strumento("impostazioni", { notifiche: { boh: false } })).isError, "tipo sconosciuto");
  await call(dati, "/api/dati", { method: "POST", headers: H, body: { changes: { impostazioni: { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 12 } } } });
  await st.setJSON("t-" + CODE, { ...t0 });
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
  await st.setJSON("t-" + CODE, { ...t, tz, ultimo_avviso_sera: null });
  inviati.length = 0; await bot();
  const msg = inviati.find((x) => x[0] === "sendMessage" && x[1].text.includes("Il piano di Claude"));
  assert.ok(msg, "avviso di fine piano");
  assert.match(msg[1].text, /finisce domani/);
  assert.match(msg[1].reply_markup.inline_keyboard[0][0].url, /^https:\/\/claude\.ai\/new\?q=/);
  const t2 = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t2, tz, ultimo_avviso_sera: null });
  inviati.length = 0; await bot();
  assert.ok(!inviati.some((x) => x[0] === "sendMessage" && x[1].text.includes("Il piano di Claude")), "non si ripete per lo stesso piano");
});

test("crediti Netlify: una versione contata una volta, avviso su Telegram sopra l'80% una volta al mese", async () => {
  const c1 = (await call(dati, "/api/dati?op=crediti", { headers: H })).body, c2 = (await call(dati, "/api/dati?op=crediti", { headers: H })).body;
  assert.equal(c1.pubblicazioni, 1); assert.equal(c2.pubblicazioni, 1); assert.equal(c1.limite, 300); assert.equal(c1.stima, 30);
  const st = getStore({ name: "giardino" }), key = "u-" + c1.mese, u = await st.get(key, { type: "json" });
  await st.setJSON(key, { ...u, versioni: [...u.versioni, ...Array.from({ length: 15 }, (_, i) => "v" + i)] });
  const tz = "Etc/GMT" + ((h) => (h >= 0 ? "+" : "") + h)(new Date().getUTCHours() - 12), t = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t, tz, ultimo_invio: null, ultimo_avviso_sera: null });
  inviati.length = 0; await bot();
  assert.ok(inviati.some((x) => x[0] === "sendMessage" && /Crediti Netlify/.test(x[1].text)), "avviso crediti");
  assert.ok(inviati.some((x) => x[0] === "sendMessage" && /Giardino —/.test(x[1].text)), "il messaggio del mattino parte lo stesso");
  const t2 = await st.get("t-" + CODE, { type: "json" }); await st.setJSON("t-" + CODE, { ...t2, tz, ultimo_invio: null, ultimo_avviso_sera: null });
  inviati.length = 0; await bot();
  assert.ok(!inviati.some((x) => x[0] === "sendMessage" && /Crediti Netlify/.test(x[1].text)), "una volta al mese");
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
  await st.setJSON("t-" + C2, { token: "TOK2", chat_id: 99, tz, notificati: {}, ultimo_invio: null, ultimo_avviso_sera: null, ultimo_backup: new Date().toISOString().slice(0, 7) });
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
