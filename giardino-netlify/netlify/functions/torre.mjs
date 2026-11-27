import { store, leggi, reply, meteo, oraLocale, M } from "../lib/core.mjs";
import { unisciMisure, configTorre, finestreGelo } from "../lib/torre.mjs";

/* Giardino · la torre idroponica (ESP32) manda qui le misure e riceve le impostazioni.
   POST /api/torre  intestazione x-torre-chiave: <chiave data dall'app>
        { v, fw, rev, avvio, sec, ora?, stato:{modo, pompa, t, u, rssi}, misure:[[ora|null, t, u, pompaS, modo, avvio, sec], …] }
     → { ok, nuove, ora, config? (se rev è diverso da quello della torre), comando? ({pompa_s, id}, una volta sola),
         gelo? ([[da, a], …] ore di gelo previste stanotte, in secondi: l'ESP32 le usa solo se il suo sensore non risponde) }
   La torre lavora da sola: qui arrivano i dati quando trova il Wi-Fi (anche giorni dopo). */
export const config = { path: "/api/torre", rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip", "domain"] } };
const MAX = 300 * 1024;

export default async (request) => {
  if (request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
  const chiave = String(request.headers.get("x-torre-chiave") || "");
  if (!/^[A-Z2-7]{26}$/.test(chiave)) return reply({ error: "chiave mancante" }, 403);
  const st = store(), k = await st.get("k-" + chiave, { type: "json" });
  if (!k?.code) return reply({ error: "chiave non valida" }, 403);
  const raw = await request.text();
  if (raw.length > MAX) return reply({ error: "troppi dati" }, 413);
  let body; try { body = JSON.parse(raw); } catch { return reply({ error: "JSON non valido" }, 400); }
  const cur = await leggi(st, k.code), torre = cur?.data?.torre;
  if (!torre || torre.chiave !== chiave) return reply({ error: "chiave non valida" }, 403);
  const adesso = Math.floor(Date.now() / 1000), sk = "s-" + k.code;
  const { serie, nuove } = unisciMisure(await st.get(sk, { type: "json" }), body, adesso);
  // accensione a mano chiesta dall'app: una volta sola, e solo se chiesta nelle ultime 2 ore
  const c = torre.comando; let comando = null;
  if (torre.attiva !== false && c?.id && +c.pompa_s > 0 && Date.parse(c.at) > Date.now() - 2 * 3600e3 && !serie.fatti.includes(c.id)) {
    comando = { pompa_s: Math.min(600, Math.round(+c.pompa_s)), id: c.id };
    serie.fatti = [...serie.fatti, c.id].slice(-20);
  }
  await st.setJSON(sk, serie);
  const r = { ok: true, nuove, ora: adesso };
  if (+body?.rev !== +torre.rev) r.config = { ...configTorre(torre.config), rev: +torre.rev || 1 };
  if (comando) r.comando = comando;
  // ore di gelo previste: sempre (anche vuote), così l'ESP32 dimentica quelle vecchie; senza meteo non si manda niente
  try {
    const loc = M.vistaOrto(cur.data, torre.orto || "p").location;
    if (torre.posizione === "casa") r.gelo = [];
    else if (loc) { const met = await meteo(loc.lat, loc.lon); r.gelo = finestreGelo(torre, met, oraLocale(met.tz || "Europe/Rome").oggi, met.tz || "Europe/Rome"); }
  } catch { /* meteo non disponibile: l'ESP32 tiene quelle di prima */ }
  return reply(r);
};
