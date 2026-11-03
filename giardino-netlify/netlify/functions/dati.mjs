import { store, reply, codiceDa, newToken, leggi, aggiorna, CAMPI, siteUrl, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, COMANDI } from "../lib/core.mjs";

/* Giardino · dati dell'app, chiave del connettore per Claude, bot Telegram.
   Il codice di sincronizzazione (lungo e casuale, generato dall'app) è la chiave: chi lo conosce legge e scrive.
   Viaggia nell'intestazione x-giardino-code (non nell'indirizzo, così non resta nei log); ?code=X vale ancora per le app non aggiornate.

   GET  /api/dati                      → { rev, data }  (data null se non c'è ancora niente)
   POST /api/dati  { changes:{campo:valore}, add:[eventi], remove:[id eventi] }
        Unisce sul server: i campi cambiati sostituiscono quelli salvati, gli eventi si aggiungono o tolgono uno per uno.
        Così le modifiche fatte nel frattempo da Claude o da Telegram non si perdono.
   GET/POST /api/dati?op=mcp          { action: on | new | off | write, on }   chiave per Claude
   GET/POST /api/dati?op=telegram     { action: token, token } | { action: test } | { action: off } */

export const config = { path: "/api/dati", rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["ip", "domain"] } };
const MAX = 2 * 1024 * 1024;

export default async (request) => {
  const url = new URL(request.url), code = codiceDa(request), op = url.searchParams.get("op") || "";
  if (!code) return reply({ error: "codice mancante o non valido" }, 400);
  const st = store();
  try {
    if (op === "mcp") return await opMcp(request, st, code);
    if (op === "telegram") return await opTelegram(request, st, code);
    if (request.method === "GET") { const cur = await leggi(st, code); return reply(cur ? { rev: cur.rev, updatedAt: cur.updatedAt, data: cur.data } : { rev: 0, data: null }); }
    if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
    const raw = await request.text();
    if (raw.length > MAX) return reply({ error: "dati troppo grandi" }, 413);
    let body; try { body = JSON.parse(raw); } catch { return reply({ error: "JSON non valido" }, 400); }
    const changes = body && typeof body.changes === "object" && body.changes ? body.changes : {};
    const add = Array.isArray(body?.add) ? body.add : [], remove = new Set(Array.isArray(body?.remove) ? body.remove.map(String) : []);
    const out = await aggiorna(st, code, (d) => {
      for (const k of CAMPI) if (Object.prototype.hasOwnProperty.call(changes, k)) d[k] = changes[k];
      if (remove.size) d.eventi = d.eventi.filter((e) => !(remove.has(String(e.id)) && e.fonte === "app"));
      for (const e of add) if (e && e.id && !d.eventi.some((x) => x.id === e.id)) d.eventi.push({ ...e, fonte: "app" });
    });
    return reply({ rev: out.rev, updatedAt: out.updatedAt, data: out.data });
  } catch (e) {
    console.error(e);
    return reply({ error: e?.message || "errore" }, 500);
  }
};

async function opMcp(request, st, code) {
  const mkey = "m-" + code;
  const f = await st.getWithMetadata(mkey, { type: "json" });
  const cur = f?.data || null, on = !!cur?.token;
  const stato = (c) => ({ active: true, token: c.token, write: c.write === true });
  if (request.method === "GET") return reply(on ? stato(cur) : { active: false });
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
  const stato = (x) => x ? { configured: true, username: x.username || "", collegato: !!x.chat_id } : { configured: false };
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
