import { createHash } from "node:crypto";
import { VERSIONE } from "../lib/versione.mjs";
import { nuovaTorre, torreDallApp, serieVuota, GIORNI_TORRE } from "../lib/torre.mjs";
import { store, reply, comprimi, riconosciPianta, codiceDa, newToken, misureArpae, inEmiliaRomagna, leggi, aggiorna, CAMPI, siteUrl, tg, meteo, oraLocale, pianoAttivo, pianiOrti, messaggioMattina, COMANDI, M } from "../lib/core.mjs";

/* Giardino · dati dell'app, chiave del connettore per Claude, bot Telegram.
   Il codice di sincronizzazione (lungo e casuale, generato dall'app) è la chiave: chi lo conosce legge e scrive.
   Viaggia nell'intestazione x-giardino-code (non nell'indirizzo, così non resta nei log); ?code=X vale ancora per le app non aggiornate.

   GET  /api/dati                      → { rev, data }  (data null se non c'è ancora niente)
        con l'intestazione x-giardino-versione = "rev-updatedAt" già in mano all'app → { rev, updatedAt, invariato: true }
        se nel frattempo non è cambiato niente (pochi byte invece di tutti i dati: il controllo ogni 5 minuti costa quasi zero)
   GET  /api/dati?op=stato            → { mcp, telegram }  lo stato per le Impostazioni, in una richiesta sola
   GET  /api/dati?op=pioggia          → pioggia misurata ARPAE (quarti d'ora e ore) della stazione più vicina
   GET  /api/dati?op=meteo            → meteo del server, quando l'app non raggiunge Open-Meteo (anche la riserva MET Norway)
   POST /api/dati  { changes:{campo:valore}, add:[eventi], remove:[id eventi] }
        Unisce sul server: i campi cambiati sostituiscono quelli salvati, gli eventi si aggiungono o tolgono uno per uno.
        Così le modifiche fatte nel frattempo da Claude o da Telegram non si perdono.
   GET/POST /api/dati?op=mcp          { action: on | new | off | write, on }   chiave per Claude
   GET/POST /api/dati?op=telegram     { action: token, token } | { action: test } | { action: off }
   POST /api/dati?op=riconosci       { immagine: data URL JPEG } → { risultati:[{nome, scientifico, specie, probabilita}] } (Pl@ntNet)
   GET  /api/dati?op=torre&giorni=8   → { stato, ultimo, misure:[[ora, t, u, pompaS, modo], …] }  misure della torre idroponica
   POST /api/dati?op=torre            { action: chiave | togli }  crea (o cambia) la chiave della torre, oppure la toglie con le misure
   POST /api/dati?op=firmware         corpo: il .bin del programma della torre (l'ESP32 lo installa al prossimo collegamento); DELETE lo toglie
   GET  /api/dati?op=versione         → { versione }  impronta della versione online, senza codice (per il controllo dopo la pubblicazione) */

export const config = { path: "/api/dati", rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["ip", "domain"] } };
const MAX = 2 * 1024 * 1024;

// risposte grandi compresse se il telefono le accetta (vedi comprimi in core.mjs)
export default async (request) => comprimi(request, await gestisci(request));

async function gestisci(request) {
  const url = new URL(request.url), code = codiceDa(request), op = url.searchParams.get("op") || "";
  if (op === "versione") return reply({ versione: VERSIONE });
  if (!code) return reply({ error: "codice mancante o non valido" }, 400);
  const st = store();
  try {
    if (op === "mcp") return await opMcp(request, st, code);
    if (op === "telegram") return await opTelegram(request, st, code);
    if (op === "torre") return await opTorre(request, st, code, url);
    if (op === "firmware") return await opFirmware(request, st, code);
    if (op === "riconosci") {   // foto della pianta → specie più probabili (Pl@ntNet)
      if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
      const b = await request.json().catch(() => null), r = await riconosciPianta(b?.immagine);
      return r.errore ? reply({ error: r.errore }, r.codice || 502) : reply(r);
    }
    // ?orto=<id>: la posizione di quell'orto (senza, l'orto principale)
    const ortoQ = url.searchParams.get("orto") || "p", posOrto = (cur) => cur?.data ? M.vistaOrto(cur.data, ortoQ).location : null;
    if (op === "meteo") {   // l'app non raggiunge Open-Meteo: il meteo del server (Open-Meteo o la riserva MET Norway)
      const cur = await leggi(st, code), l = posOrto(cur);
      if (!l) return reply({ error: "manca la posizione" }, 409);
      const met = await meteo(l.lat, l.lon);
      return reply({ ...met, lat: l.lat, lon: l.lon });
    }
    if (op === "pioggia") {   // pioggia misurata dalla stazione ARPAE più vicina (ogni 15 minuti), per «l'ho messa sotto la pioggia»
      const cur = await leggi(st, code), l = posOrto(cur);
      if (!l || !inEmiliaRomagna(l.lat, l.lon)) return reply({ disponibile: false, motivo: "Le misure ARPAE ci sono solo in Emilia-Romagna." });
      const c = await misureArpae(st, l.lat, l.lon, null, { massimaEta: 15 * 60e3 });
      if (!c?.stazione) return reply({ disponibile: false, motivo: "Le misure della stazione ARPAE non sono raggiungibili adesso: riprova tra poco." });
      return reply({ disponibile: true, stazione: c.stazione.nome, km: c.stazione.km, ore: c.ore, quarti: c.quarti, aggiornato: c.at });
    }
    if (op === "stato") {
      const [m, t] = await Promise.all([st.get("m-" + code, { type: "json" }), st.get("t-" + code, { type: "json" })]);
      return reply({ mcp: statoMcp(m), telegram: statoTelegram(t) });
    }
    if (request.method === "GET") {
      const cur = await leggi(st, code);
      if (cur && request.headers.get("x-giardino-versione") === cur.rev + "-" + cur.updatedAt) return reply({ rev: cur.rev, updatedAt: cur.updatedAt, invariato: true });
      return reply(cur ? { rev: cur.rev, updatedAt: cur.updatedAt, data: cur.data } : { rev: 0, data: null });
    }
    if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
    const raw = await request.text();
    if (raw.length > MAX) return reply({ error: "dati troppo grandi" }, 413);
    let body; try { body = JSON.parse(raw); } catch { return reply({ error: "JSON non valido" }, 400); }
    const changes = body && typeof body.changes === "object" && body.changes ? body.changes : {};
    const add = Array.isArray(body?.add) ? body.add : [], remove = new Set(Array.isArray(body?.remove) ? body.remove.map(String) : []);
    const piante = body && typeof body.piante === "object" && body.piante ? body.piante : null;
    const out = await aggiorna(st, code, (d) => {
      for (const k of CAMPI) if (Object.prototype.hasOwnProperty.call(changes, k)) d[k] = k === "plants" ? conSchede(changes.plants, d.plants) : k === "torre" ? torreDallApp(changes.torre, d.torre) : changes[k];
      if (piante) d.plants = unisciPiante(d.plants, piante);
      if (remove.size) d.eventi = d.eventi.filter((e) => !(remove.has(String(e.id)) && e.fonte === "app"));
      for (const e of add) if (e && e.id && !d.eventi.some((x) => x.id === e.id)) d.eventi.push({ ...e, fonte: "app" });
    });
    return reply({ rev: out.rev, updatedAt: out.updatedAt, data: out.data });
  } catch (e) {
    console.error(e);
    return reply({ error: e?.message || "errore" }, 500);
  }
}

// Piante cambiate pianta per pianta (app dalla versione con il lavoro senza rete): {set: piante nuove o cambiate,
// del: id tolte, ordine: id nell'ordine dell'app}. Le altre restano come sono sul server: una pianta aggiunta da Claude o da
// un altro telefono mentre questo era senza rete non si perde più (prima l'app mandava tutto l'elenco e lo sostituiva).
export function unisciPiante(server, { set, del, ordine } = {}) {
  const via = new Set(Array.isArray(del) ? del.map(String) : []), nuove = (Array.isArray(set) ? set : []).filter((p) => p && typeof p === "object" && p.id);
  const per = new Map(nuove.map((p) => [String(p.id), p]));
  let out = (Array.isArray(server) ? server : []).filter((p) => p && !via.has(String(p.id))).map((p) => (per.has(String(p.id)) ? per.get(String(p.id)) : p));
  const ci = new Set(out.map((p) => String(p.id)));
  for (const p of nuove) if (!ci.has(String(p.id)) && !via.has(String(p.id))) out.push(p);
  out = conSchede(out, server);
  if (Array.isArray(ordine) && ordine.length) { const pos = new Map(ordine.map((id, i) => [String(id), i])); out = out.map((p, i) => [p, pos.get(String(p.id)) ?? 1e6 + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]); }
  return out;
}
// La scheda di ogni pianta la scrive Claude sul server: se l'app manda le piante senza scheda, o con una più vecchia,
// resta quella più recente (l'app può essere rimasta indietro di qualche minuto). Lo stesso per l'acqua di tutta la vita:
// l'inizio (aggiunta) resta il più vecchio, la pioggia già contata (pioggia_vita) la più recente e il riporto del diario
// potato (vita_vecchia) quello del server, così un'app rimasta indietro non li toglie e il totale non torna indietro.
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
function conSchede(nuove, vecchie) {
  if (!Array.isArray(nuove)) return nuove;
  const prima = new Map((Array.isArray(vecchie) ? vecchie : []).map((p) => [p?.id, p]));
  return nuove.map((p) => {
    if (!p || typeof p !== "object") return p;
    const o = prima.get(p.id) || {}, a = p.scheda, b = o.scheda, s = !a ? b : !b ? a : String(a.aggiornata || "") >= String(b.aggiornata || "") ? a : b;
    const ag = [p.aggiunta, o.aggiunta].filter((x) => GIORNO.test(x || "")).sort()[0];
    const pv = [p.pioggia_vita, o.pioggia_vita].filter((x) => x && typeof x === "object" && GIORNO.test(x.fino || "")).sort((x, y) => (x.fino < y.fino ? 1 : -1))[0];
    const vv = o.vita_vecchia || p.vita_vecchia;   // la scrive solo il server
    return s || ag || pv || vv ? { ...p, ...(s ? { scheda: s } : {}), ...(ag ? { aggiunta: ag } : {}), ...(pv ? { pioggia_vita: pv } : {}), ...(vv ? { vita_vecchia: vv } : {}) } : p;
  });
}

const statoMcp = (c) => c?.token ? { active: true, token: c.token, write: c.write === true } : { active: false };
const statoTelegram = (x) => x ? { configured: true, username: x.username || "", collegato: !!x.chat_id, chat_id: x.chat_id || null } : { configured: false };
async function opMcp(request, st, code) {
  const mkey = "m-" + code;
  const f = await st.getWithMetadata(mkey, { type: "json" });
  const cur = f?.data || null, on = !!cur?.token;
  const stato = statoMcp;
  if (request.method === "GET") return reply(stato(cur));
  const body = await request.json().catch(() => null), action = body?.action;
  if (action === "off") { if (on) await st.delete("r-" + cur.token); await st.delete(mkey); return reply({ active: false }); }
  if (action === "write") {
    if (!on) return reply({ error: "collegamento non attivo" }, 409);
    const next = { ...cur, write: body.on === true }; await st.setJSON(mkey, next); return reply(stato(next));
  }
  if (action === "on" && on) return reply(stato(cur));
  if (action !== "on" && action !== "new") return reply({ error: "azione non valida" }, 400);
  const token = newToken(), next = { token, at: Date.now(), write: on ? cur.write === true : true };
  await st.setJSON("r-" + token, { code });
  await st.setJSON(mkey, next);
  if (on) await st.delete("r-" + cur.token);
  return reply(stato(next));
}

// Torre idroponica: misure (lette qui, fuori dai dati dell'app) e chiave per l'ESP32
async function opTorre(request, st, code, url) {
  if (request.method === "GET") {
    const giorni = Math.max(1, Math.min(GIORNI_TORRE, parseInt(url.searchParams.get("giorni")) || 8)), s = (await st.get("s-" + code, { type: "json" })) || serieVuota();
    const da = Math.floor(Date.now() / 1000) - giorni * 86400;
    return reply({ stato: s.stato, ultimo: s.ultimo, misure: s.misure.filter((r) => r[0] >= da).map((r) => r.slice(0, 5)), giorni: s.giorni || [], riavvii: (s.riavvii || []).slice(-20), memoria_formattata: s.memoria_formattata || 0 });
  }
  const body = await request.json().catch(() => null), action = body?.action;
  if (action === "chiave") {   // la prima volta crea la torre; poi cambia la chiave (quella vecchia non vale più)
    const chiave = newToken(); let vecchia = null;
    await st.setJSON("k-" + chiave, { code });
    const out = await aggiorna(st, code, (d) => { vecchia = d.torre?.chiave || null; d.torre = d.torre ? { ...d.torre, chiave, attiva: true } : nuovaTorre(chiave); });
    if (vecchia && vecchia !== chiave) await st.delete("k-" + vecchia);
    return reply({ torre: out.data.torre, rev: out.rev, updatedAt: out.updatedAt });
  }
  if (action === "togli") {
    let vecchia = null;
    const out = await aggiorna(st, code, (d) => { vecchia = d.torre?.chiave || null; if (!d.torre) return false; delete d.torre; });
    if (vecchia) await st.delete("k-" + vecchia);
    await st.delete("s-" + code);
    await st.delete("f-" + code);
    return reply({ torre: null, rev: out?.rev });
  }
  return reply({ error: "azione non valida" }, 400);
}

// Programma nuovo per l'ESP32 della torre (il .bin esportato dall'Arduino IDE): la torre lo scarica e lo installa da sola.
// Si riconosce dal primo byte (0xE9, immagine ESP32) e dalla firma «GIARDINO-TORRE-FW:<versione>:» che il programma contiene.
const FW_MAX = 1920 * 1024;
async function opFirmware(request, st, code) {
  const cur = await leggi(st, code);
  if (!cur?.data?.torre) return reply({ error: "nessuna torre" }, 400);
  if (request.method === "DELETE") {
    await st.delete("f-" + code);
    const out = await aggiorna(st, code, (d) => { if (!d.torre?.firmware) return false; delete d.torre.firmware; });
    return reply({ torre: out?.data?.torre ?? cur.data.torre });
  }
  if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
  const bin = new Uint8Array(await request.arrayBuffer());
  if (!bin.length || bin.length > FW_MAX) return reply({ error: `il file deve essere il .bin del programma (al massimo ${FW_MAX / 1024} KB)` }, 413);
  if (bin[0] !== 0xe9) return reply({ error: "non è un programma per ESP32: esporta il .bin dall'Arduino IDE (Sketch → Esporta binario compilato)" }, 400);
  const m = /GIARDINO-TORRE-FW:(\d{1,5}):/.exec(Buffer.from(bin).toString("latin1"));
  if (!m) return reply({ error: "non è il programma della torre (manca la firma GIARDINO-TORRE-FW)" }, 400);
  const versione = +m[1], md5 = createHash("md5").update(bin).digest("hex");
  await st.set("f-" + code, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
  const out = await aggiorna(st, code, (d) => { if (!d.torre) return false; d.torre.firmware = { versione, md5, dimensione: bin.length, caricato: new Date().toISOString() }; });
  return reply({ torre: out.data.torre, rev: out.rev, updatedAt: out.updatedAt });
}

async function opTelegram(request, st, code) {
  const tkey = "t-" + code;
  const t = await st.get(tkey, { type: "json" });
  const stato = statoTelegram;
  if (request.method === "GET") return reply(stato(t));
  const body = await request.json().catch(() => null), action = body?.action;
  if (action === "off") {
    if (t) { await tg(t.token, "deleteWebhook", {}, { ignora: true }); await st.delete("w-" + t.secret); await st.delete(tkey); }
    return reply({ configured: false });
  }
  if (action === "token") {
    const token = String(body?.token || "").trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) return reply({ error: "Il token non sembra quello di @BotFather (numeri, due punti, lettere)." }, 400);
    let me; try { me = await tg(token, "getMe"); } catch { return reply({ error: "Telegram non riconosce questo token: copialo di nuovo da @BotFather." }, 400); }
    const secret = newToken(32);
    await tg(token, "setMyCommands", { commands: COMANDI }, { ignora: true });
    await tg(token, "setWebhook", { url: siteUrl(request) + "/api/telegram/" + secret, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    if (t?.secret) await st.delete("w-" + t.secret);
    await st.setJSON("w-" + secret, { code });
    const next = { token, secret, username: me.username, chat_id: t && t.token === token ? t.chat_id || null : null, notificati: {}, ultimo_invio: null, ultimo_avviso_sera: null };
    await st.setJSON(tkey, next);
    return reply(stato(next));
  }
  if (action === "test") {
    if (!t?.chat_id) return reply({ error: "Prima apri il bot su Telegram e premi Avvia." }, 409);
    const cur = await leggi(st, code);
    if (!M.vistePiene(cur?.data || {}).length) { await tg(t.token, "sendMessage", { chat_id: t.chat_id, text: "🪴 Giardino è collegato. Aggiungi la posizione e le piante nell'app per ricevere il piano." }); return reply({ ok: true }); }
    for (const x of await pianiOrti(cur.data)) {
      const { msg } = messaggioMattina(x.v, x.ap, x.oggi, { prova: true });
      await tg(t.token, "sendMessage", { chat_id: t.chat_id, text: "🧪 <i>Messaggio di prova</i>\n\n" + msg, parse_mode: "HTML", disable_web_page_preview: true });
    }
    return reply({ ok: true });
  }
  return reply({ error: "azione non valida" }, 400);
}
