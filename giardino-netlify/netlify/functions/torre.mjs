import { store, leggi, reply, meteo, oraLocale, tg, notifica, esc, M } from "../lib/core.mjs";
import { unisciMisure, configTorre, finestreGelo, urgentiTorre } from "../lib/torre.mjs";

/* Giardino · la torre idroponica (ESP32) manda qui le misure e riceve le impostazioni.
   POST /api/torre  intestazione x-torre-chiave: <chiave data dall'app>
        { v, fw, rev, avvio, sec, ora?, stato:{modo, pompa, t, u, rssi, da, fine, riavvio, memoria}, misure:[[ora|null, t, u, pompaS, modo, avvio, sec], …] }
     → { ok, nuove, ora, config? (se rev è diverso da quello della torre), comando? ({pompa_s, id}, una volta sola),
         gelo? ([[da, a], …] ore di gelo previste stanotte, in secondi: l'ESP32 le usa solo se il suo sensore non risponde) }
   La torre lavora da sola: qui arrivano i dati quando trova il Wi-Fi (anche giorni dopo).
   Avvisi urgenti (sensore guasto, pompa ferma per il freddo, limite di sicurezza, riavvii anomali) partono subito su Telegram. */
export const config = { path: "/api/torre", rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip", "domain"] } };
const MAX = 300 * 1024;
// l'ESP32 aspetta la risposta 15 secondi: meteo e Telegram hanno al massimo 3 secondi ciascuno
const entro = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t)); };

/* A ogni invio (ogni 15 minuti e a ogni accensione e spegnimento della pompa) il meno possibile:
   chiave → dati dell'app e serie insieme → (una volta l'ora) meteo → serie scritta. Del meteo si tiene nella serie solo
   quello che serve fino all'ora dopo: fuso, ore di gelo previste e 40 giorni di evaporazione (per la stima del serbatoio
   negli avvisi urgenti). Un meteo non riuscito non si salva: si riprova all'invio dopo. */
const METEO_ORA = 3600;
function meteoRidotto(met, oggi) {
  const giorni = {};
  for (const [d, v] of Object.entries(met?.archivio || {})) if (d >= M.addDays(oggi, -30) && Array.isArray(v)) giorni[d] = v.slice(0, 4);
  for (const d of met?.days || []) if (d?.date) giorni[d.date] = [d.tmin ?? null, d.tmax ?? null, d.rain ?? 0, d.et0 ?? null];
  return giorni;
}

export default async (request) => {
  const st = store(), chiave = String(request.headers.get("x-torre-chiave") || "");
  if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
  if (!/^[A-Z2-7]{26}$/.test(chiave)) return reply({ error: "chiave mancante" }, 403);
  const k = await st.get("k-" + chiave, { type: "json" });
  if (!k?.code) return reply({ error: "chiave non valida" }, 403);
  const code = k.code, sk = "s-" + code;
  const [cur, prima] = await Promise.all([leggi(st, code), st.get(sk, { type: "json" })]);
  const torre = cur?.data?.torre;
  if (!torre || torre.chiave !== chiave) return reply({ error: "chiave non valida" }, 403);
  const raw = await request.text();
  if (raw.length > MAX) return reply({ error: "troppi dati" }, 413);
  let body; try { body = JSON.parse(raw); } catch { return reply({ error: "JSON non valido" }, 400); }
  const adesso = Math.floor(Date.now() / 1000);
  // meteo del posto della torre, una volta l'ora (o se cambiano posizione, orto o temperatura di stop)
  const chiaveM = [torre.posizione, torre.orto || "p", configTorre(torre.config).freddo_stop].join("|"), cm = prima?.meteo_torre;
  let tz = cm?.tz || "Europe/Rome", met = null, gelo = cm?.chiave === chiaveM ? cm.gelo : null;
  if (!cm || cm.chiave !== chiaveM || adesso - cm.at >= METEO_ORA) {
    const loc = M.vistaOrto(cur.data, torre.orto || "p").location;
    met = loc ? await entro(meteo(loc.lat, loc.lon).catch(() => null), 3000) : null;
    if (met) { tz = met.tz || tz; gelo = torre.posizione === "casa" ? [] : finestreGelo(torre, met, oraLocale(tz).oggi, tz); }
  }
  const { serie, nuove } = unisciMisure(prima, body, adesso, tz);
  if (met) serie.meteo_torre = { chiave: chiaveM, at: adesso, tz, lat: met.lat ?? null, gelo, giorni: meteoRidotto(met, oraLocale(tz).oggi) };
  // per gli avvisi: il meteo appena chiesto, o quello ridotto dell'ultima ora
  const metAvvisi = met || (serie.meteo_torre ? { lat: serie.meteo_torre.lat ?? 44, archivio: serie.meteo_torre.giorni || {}, days: [], tz } : null);
  // accensione a mano chiesta dall'app: una volta sola, e solo se chiesta nelle ultime 2 ore
  const c = torre.comando; let comando = null;
  if (torre.attiva !== false && c?.id && +c.pompa_s > 0 && Date.parse(c.at) > Date.now() - 2 * 3600e3 && !serie.fatti.includes(c.id)) {
    comando = { pompa_s: Math.min(600, Math.round(+c.pompa_s)), id: c.id };
    serie.fatti = [...serie.fatti, c.id].slice(-20);
  }
  // avvisi urgenti su Telegram, subito (torre accesa nell'app e notifica «torre» accesa)
  if (torre.attiva !== false && notifica(cur.data.impostazioni, "torre")) {
    const u = urgentiTorre(torre, serie, adesso, tz, metAvvisi, cur.data.plants);
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
  else if (gelo) r.gelo = gelo;
  return reply(r);
};
