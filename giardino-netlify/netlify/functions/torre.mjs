import { store, leggi, aggiorna, reply, meteo, oraLocale, tg, notifica, esc, M } from "../lib/core.mjs";
import { unisciMisure, configTorre, finestreGelo, urgentiTorre } from "../lib/torre.mjs";

/* Giardino · la torre idroponica (ESP32) manda qui le misure e riceve le impostazioni.
   POST /api/torre  intestazione x-torre-chiave: <chiave data dall'app>
        { v, fw, rev, avvio, sec, ora?, stato:{modo, pompa, t, u, rssi, da, fine, riavvio, memoria}, misure:[[ora|null, t, u, pompaS, modo, avvio, sec], …] }
     → { ok, nuove, ora, config? (se rev è diverso da quello della torre), comando? ({pompa_s, id}, una volta sola),
         gelo? ([[da, a], …] ore di gelo previste stanotte, in secondi: l'ESP32 le usa solo se il suo sensore non risponde),
         firmware? ({versione, dimensione, md5}: c'è un programma nuovo caricato dall'app) }
   GET /api/torre?firmware=1  (stessa intestazione) → il programma nuovo (.bin) da installare
   La torre lavora da sola: qui arrivano i dati quando trova il Wi-Fi (anche giorni dopo).
   Avvisi urgenti (sensore guasto, pompa ferma per il freddo, limite di sicurezza, riavvii anomali) partono subito su Telegram. */
export const config = { path: "/api/torre", rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip", "domain"] } };
const MAX = 300 * 1024;
// l'ESP32 aspetta la risposta 15 secondi: meteo e Telegram hanno al massimo 3 secondi ciascuno
const entro = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function torreDi(st, chiave) {
  if (!/^[A-Z2-7]{26}$/.test(chiave)) return null;
  const k = await st.get("k-" + chiave, { type: "json" });
  if (!k?.code) return null;
  const cur = await leggi(st, k.code), torre = cur?.data?.torre;
  return torre && torre.chiave === chiave ? { code: k.code, cur, torre } : null;
}

export default async (request) => {
  const st = store(), chiave = String(request.headers.get("x-torre-chiave") || "");
  // il programma nuovo, scaricato dall'ESP32
  if (request.method === "GET") {
    if (new URL(request.url).searchParams.get("firmware") !== "1") return reply({ error: "richiesta non valida" }, 400);
    const t = await torreDi(st, chiave);
    if (!t) return reply({ error: "chiave non valida" }, 403);
    const bin = t.torre.firmware ? await st.get("f-" + t.code, { type: "arrayBuffer" }) : null;
    if (!bin) return reply({ error: "nessun programma" }, 404);
    return new Response(bin, { status: 200, headers: { "content-type": "application/octet-stream", "content-length": String(bin.byteLength), "cache-control": "no-store" } });
  }
  if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
  if (!/^[A-Z2-7]{26}$/.test(chiave)) return reply({ error: "chiave mancante" }, 403);
  const t = await torreDi(st, chiave);
  if (!t) return reply({ error: "chiave non valida" }, 403);
  const raw = await request.text();
  if (raw.length > MAX) return reply({ error: "troppi dati" }, 413);
  let body; try { body = JSON.parse(raw); } catch { return reply({ error: "JSON non valido" }, 400); }
  const { code, cur, torre } = t, adesso = Math.floor(Date.now() / 1000), sk = "s-" + code;
  // meteo del posto della torre: fuso orario (riassunti per giorno) e ore di gelo previste
  const loc = M.vistaOrto(cur.data, torre.orto || "p").location;
  const met = loc ? await entro(meteo(loc.lat, loc.lon).catch(() => null), 3000) : null, tz = met?.tz || "Europe/Rome";
  const { serie, nuove } = unisciMisure(await st.get(sk, { type: "json" }), body, adesso, tz);
  // accensione a mano chiesta dall'app: una volta sola, e solo se chiesta nelle ultime 2 ore
  const c = torre.comando; let comando = null;
  if (torre.attiva !== false && c?.id && +c.pompa_s > 0 && Date.parse(c.at) > Date.now() - 2 * 3600e3 && !serie.fatti.includes(c.id)) {
    comando = { pompa_s: Math.min(600, Math.round(+c.pompa_s)), id: c.id };
    serie.fatti = [...serie.fatti, c.id].slice(-20);
  }
  // avvisi urgenti su Telegram, subito (torre accesa nell'app e notifica «torre» accesa)
  if (torre.attiva !== false && notifica(cur.data.impostazioni, "torre")) {
    const u = urgentiTorre(torre, serie, adesso, tz);
    if (u.testi.length) {
      const tel = await st.get("t-" + code, { type: "json" }).catch(() => null);
      if (tel?.token && tel?.chat_id) {
        const ok = await entro(tg(tel.token, "sendMessage", { chat_id: tel.chat_id, parse_mode: "HTML", disable_web_page_preview: true,
          text: `🌱 <b>${esc(torre.nome || "Torre idroponica")}</b>\n` + u.testi.map(esc).join("\n") }, { ignora: true }).catch(() => null), 3000);
        if (ok) serie.urgenti = u.urgenti;
      }
    } else serie.urgenti = u.urgenti;
  }
  await st.setJSON(sk, serie);
  const r = { ok: true, nuove, ora: adesso };
  if (+body?.rev !== +torre.rev) r.config = { ...configTorre(torre.config), rev: +torre.rev || 1 };
  if (comando) r.comando = comando;
  // ore di gelo previste: sempre (anche vuote), così l'ESP32 dimentica quelle vecchie; senza meteo non si manda niente
  if (torre.posizione === "casa") r.gelo = [];
  else if (met) r.gelo = finestreGelo(torre, met, oraLocale(tz).oggi, tz);
  // programma nuovo caricato dall'app e più recente di quello della torre
  const fw = torre.firmware;
  if (fw?.versione && !fw.installato && +fw.versione > (+body?.fw || 0)) r.firmware = { versione: +fw.versione, dimensione: +fw.dimensione, md5: fw.md5 };
  // installato: il file si cancella (contiene nome e password del Wi-Fi e la chiave), resta solo cosa e quando
  else if (fw?.versione && !fw.installato && +body?.fw >= +fw.versione) {
    await st.delete("f-" + code);
    await aggiorna(st, code, (d) => { if (!d.torre?.firmware) return false; d.torre.firmware = { ...d.torre.firmware, installato: new Date().toISOString() }; }).catch(() => null);
  }
  return reply(r);
};
