import { VERSIONE } from "../lib/versione.mjs";
import { store, reply, codiceDa, newToken, crediti, correggiCrediti, misureArpae, inEmiliaRomagna, leggi, aggiorna, CAMPI, siteUrl, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, COMANDI } from "../lib/core.mjs";

/* Giardino · dati dell'app, chiave del connettore per Claude, bot Telegram.
   Il codice di sincronizzazione (lungo e casuale, generato dall'app) è la chiave: chi lo conosce legge e scrive.
   Viaggia nell'intestazione x-giardino-code (non nell'indirizzo, così non resta nei log); ?code=X vale ancora per le app non aggiornate.

   GET  /api/dati                      → { rev, data }  (data null se non c'è ancora niente)
        con l'intestazione x-giardino-versione = "rev-updatedAt" già in mano all'app → { rev, updatedAt, invariato: true }
        se nel frattempo non è cambiato niente (pochi byte invece di tutti i dati: il controllo ogni 5 minuti costa quasi zero)
   GET  /api/dati?op=stato            → { mcp, telegram, crediti }  lo stato per le Impostazioni, in una richiesta sola
   GET  /api/dati?op=pioggia          → pioggia misurata ARPAE (quarti d'ora e ore) della stazione più vicina
   GET  /api/dati?op=meteo            → meteo del server, quando l'app non raggiunge Open-Meteo (anche la riserva MET Norway)
   POST /api/dati  { changes:{campo:valore}, add:[eventi], remove:[id eventi] }
        Unisce sul server: i campi cambiati sostituiscono quelli salvati, gli eventi si aggiungono o tolgono uno per uno.
        Così le modifiche fatte nel frattempo da Claude o da Telegram non si perdono.
   GET/POST /api/dati?op=mcp          { action: on | new | off | write, on }   chiave per Claude
   GET/POST /api/dati?op=telegram     { action: token, token } | { action: test } | { action: off }
   GET  /api/dati?op=versione         → { versione }  impronta della versione online, senza codice (per il controllo dopo la pubblicazione) */

export const config = { path: "/api/dati", rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["ip", "domain"] } };
const MAX = 2 * 1024 * 1024;

export default async (request) => {
  const url = new URL(request.url), code = codiceDa(request), op = url.searchParams.get("op") || "";
  if (op === "versione") return reply({ versione: VERSIONE });
  if (!code) return reply({ error: "codice mancante o non valido" }, 400);
  const st = store();
  try {
    if (op === "mcp") return await opMcp(request, st, code);
    if (op === "telegram") return await opTelegram(request, st, code);
    if (op === "crediti") {
      if (request.method === "POST") {   // crediti rimasti letti su Netlify: la stima riparte da lì
        const b = await request.json().catch(() => null), n = Math.round(+b?.rimasti);
        if (!isFinite(n) || n < 0 || n > 300) return reply({ error: "scrivi i crediti rimasti, da 0 a 300" }, 400);
        const { key, ...c } = await correggiCrediti(st, n); return reply(c);
      }
      const { key, ...c } = await crediti(st); return reply(c);
    }
    if (op === "meteo") {   // l'app non raggiunge Open-Meteo: il meteo del server (Open-Meteo o la riserva MET Norway)
      const cur = await leggi(st, code), l = cur?.data?.location;
      if (!l) return reply({ error: "manca la posizione" }, 409);
      const met = await meteo(l.lat, l.lon);
      return reply({ ...met, lat: l.lat, lon: l.lon });
    }
    if (op === "pioggia") {   // pioggia misurata dalla stazione ARPAE più vicina (ogni 15 minuti), per «l'ho messa sotto la pioggia»
      const cur = await leggi(st, code), l = cur?.data?.location;
      if (!l || !inEmiliaRomagna(l.lat, l.lon)) return reply({ disponibile: false, motivo: "Le misure ARPAE ci sono solo in Emilia-Romagna." });
      const c = await misureArpae(st, l.lat, l.lon, null, { massimaEta: 15 * 60e3 });
      if (!c?.stazione) return reply({ disponibile: false, motivo: "Le misure della stazione ARPAE non sono raggiungibili adesso: riprova tra poco." });
      return reply({ disponibile: true, stazione: c.stazione.nome, km: c.stazione.km, ore: c.ore, quarti: c.quarti, aggiornato: c.at });
    }
    if (op === "stato") {
      const [m, t, c] = await Promise.all([st.get("m-" + code, { type: "json" }), st.get("t-" + code, { type: "json" }), crediti(st).catch(() => null)]);
      return reply({ mcp: statoMcp(m), telegram: statoTelegram(t), crediti: c ? (({ key, ...x }) => x)(c) : null });
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
    const out = await aggiorna(st, code, (d) => {
      for (const k of CAMPI) if (Object.prototype.hasOwnProperty.call(changes, k)) d[k] = k === "plants" ? conSchede(changes.plants, d.plants) : changes[k];
      if (remove.size) d.eventi = d.eventi.filter((e) => !(remove.has(String(e.id)) && e.fonte === "app"));
      for (const e of add) if (e && e.id && !d.eventi.some((x) => x.id === e.id)) d.eventi.push({ ...e, fonte: "app" });
    });
    return reply({ rev: out.rev, updatedAt: out.updatedAt, data: out.data });
  } catch (e) {
    console.error(e);
    return reply({ error: e?.message || "errore" }, 500);
  }
};

// La scheda di ogni pianta la scrive Claude sul server: se l'app manda le piante senza scheda, o con una più vecchia,
// resta quella più recente (l'app può essere rimasta indietro di qualche minuto).
function conSchede(nuove, vecchie) {
  if (!Array.isArray(nuove)) return nuove;
  const prima = new Map((Array.isArray(vecchie) ? vecchie : []).map((p) => [p?.id, p?.scheda]));
  return nuove.map((p) => {
    if (!p || typeof p !== "object") return p;
    const a = p.scheda, b = prima.get(p.id), s = !a ? b : !b ? a : String(a.aggiornata || "") >= String(b.aggiornata || "") ? a : b;
    return s ? { ...p, scheda: s } : p;
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
    if (!cur?.data?.location || !cur.data.plants.length) { await tg(t.token, "sendMessage", { chat_id: t.chat_id, text: "🪴 Giardino è collegato. Aggiungi la posizione e le piante nell'app per ricevere il piano." }); return reply({ ok: true }); }
    const met = await meteo(cur.data.location.lat, cur.data.location.lon), { oggi } = oraLocale(met.tz);
    const { msg } = messaggioMattina(cur.data, pianoAttivo(cur.data, met, oggi), oggi, { prova: true });
    await tg(t.token, "sendMessage", { chat_id: t.chat_id, text: "🧪 <i>Messaggio di prova</i>\n\n" + msg, parse_mode: "HTML", disable_web_page_preview: true });
    return reply({ ok: true });
  }
  return reply({ error: "azione non valida" }, 400);
}
