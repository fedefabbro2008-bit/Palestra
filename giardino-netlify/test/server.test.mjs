// Funzioni del sito: dati, connettore per Claude, Telegram (webhook e bot orario), Siri.
// Si lancia con:  node --import ./test/registra-finto.mjs --test test/server.test.mjs   (dalla cartella giardino-netlify)
import { test } from "node:test";
import assert from "node:assert/strict";
import { inviati, OGGI } from "./rete-finta.mjs";
import { getStore } from "@netlify/blobs";
const dati = (await import("../netlify/functions/dati.mjs")).default;
const mcp = (await import("../netlify/functions/mcp.mjs")).default;
const telegram = (await import("../netlify/functions/telegram.mjs")).default;
const bot = (await import("../netlify/functions/bot.mjs")).default;
const siri = (await import("../netlify/functions/siri.mjs")).default;

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
});

let KEY;
const rpc = async (method, params = {}) => (await call(mcp, "/mcp/" + KEY, { method: "POST", body: { jsonrpc: "2.0", id: 1, method, params } })).body;
const strumento = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result;

test("connettore per Claude: lettura, zona, ordine alfabetico, permessi", async () => {
  KEY = (await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "on" } })).body.token;
  assert.match(KEY, /^[A-Z2-7]{26}$/);
  assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "giardino");
  assert.equal((await rpc("tools/list")).result.tools.length, 7);
  const g = (await strumento("giardino")).content[0].text;
  const ordine = ["Basilico", "Pomodoro", "Zucchine", "Aglio"].map((n) => g.indexOf("**" + n + "**"));
  assert.ok(ordine.every((x, i) => x > 0 && (!i || x > ordine[i - 1])), "piante per zona e in ordine alfabetico");
  assert.match(g, /\*\*Basilico\*\* \[id bas\] · zona Balcone/);
  const m = await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { zona: "  Orto  " } });
  assert.equal(m.isError, false);
  assert.equal((await leggiDati()).plants.find((p) => p.id === "agl").zona, "Orto");
  assert.equal((await strumento("modifica_pianta", { azione: "modifica", pianta: "agl", campi: { colore: "rosso" } })).isError, true);
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
  assert.equal(agl.scheda.specie, "aglio");
  assert.match((await strumento("giardino")).content[0].text, /scheda: compilata il/);
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
  await call(dati, "/api/dati?op=mcp", { method: "POST", headers: H, body: { action: "write", on: false } });
  assert.equal((await strumento("vacanza", { annulla: true })).isError, true);
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

  // /fatto balcone: solo la zona Balcone (il basilico ha già una risposta, resta il pomodoro)
  inviati.length = 0;
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/fatto Balcone" } });
  assert.match(inviati.at(-1)[1].text, /Segnate come annaffiate: Pomodoro\./);
  const d = await leggiDati();
  assert.ok(d.eventi.some((e) => e.plantId === "pom" && e.tipo === "fatto"));
  assert.ok(!d.eventi.some((e) => e.plantId === "zuc"), "la zona Orto resta da fare");
  inviati.length = 0;
  await webhook({ message: { chat: { id: 77, type: "private" }, text: "/fatto cantina" } });
  assert.match(inviati.at(-1)[1].text, /Non trovo la zona/);
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
});

test("Siri: codice in intestazione, piano di oggi a voce, «ho innaffiato» per zona", async () => {
  assert.equal((await call(siri, "/api/siri/oggi", { method: "POST" })).status, 401);
  assert.equal((await call(siri, "/api/siri/boh", { method: "POST", headers: H })).status, 404);
  assert.equal((await call(siri, "/api/siri/fatto", { headers: H })).status, 405);
  const oggi = (await call(siri, "/api/siri/oggi", { method: "POST", headers: H })).body;
  assert.match(oggi, /Zucchine, [\d,]+ litri, circa/);
  assert.doesNotMatch(oggi, /[≈½¼¾]/);
  assert.match((await call(siri, "/api/siri/oggi?zona=cantina", { headers: H })).body, /Non trovo la zona cantina/);
  const r = await call(siri, "/api/siri/fatto?zona=orto", { method: "POST", headers: H });
  assert.match(r.body, /Ho segnato come annaffiate: Zucchine\./);
  assert.ok((await leggiDati()).eventi.some((e) => e.plantId === "zuc" && e.fonte === "siri"));
  assert.match((await call(siri, "/api/siri/fatto?zona=Orto", { method: "POST", headers: H })).body, /niente da innaffiare in Orto/);
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
  const st = getStore({ name: "giardino" }), t = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t, ultimo_avviso_sera: null });
  inviati.length = 0; await bot();
  const msg = inviati.find((x) => x[0] === "sendMessage" && x[1].text.includes("Il piano di Claude"));
  assert.ok(msg, "avviso di fine piano");
  assert.match(msg[1].text, /finisce domani/);
  assert.match(msg[1].reply_markup.inline_keyboard[0][0].url, /^https:\/\/claude\.ai\/new\?q=/);
  const t2 = await st.get("t-" + CODE, { type: "json" });
  await st.setJSON("t-" + CODE, { ...t2, ultimo_avviso_sera: null });
  inviati.length = 0; await bot();
  assert.ok(!inviati.some((x) => x[0] === "sendMessage" && x[1].text.includes("Il piano di Claude")), "non si ripete per lo stesso piano");
});
