// Giardino · parti condivise dalle funzioni Netlify (dati, connettore MCP, bot Telegram).
// Archivio: Netlify Blobs, store "giardino"
//   d-<codice>    { rev, updatedAt, data }   dati dell'app (piante, posizione, impostazioni, vacanza, eventi, piano di Claude)
//   m-<codice>    { token, at, write }       chiave del connettore per Claude
//   r-<chiave>    { code }                   dalla chiave del connettore al codice
//   t-<codice>    { token, secret, chat_id, username, tz, ultimo_invio, ultimo_avviso_sera, notificati }   bot Telegram
//   w-<segreto>   { code }                   dal webhook di Telegram al codice
import { getStore } from "@netlify/blobs";
import * as M from "./modello.mjs";
import { VERSIONE } from "./versione.mjs";
export { M };

export const store = () => getStore({ name: "giardino", consistency: "strong" });
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newToken(n = 26) { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, (x) => ALPHA[x & 31]).join(""); }
export function cleanCode(raw) { const c = String(raw || "").trim().toUpperCase(); return /^[A-Z0-9-]{16,64}$/.test(c) ? c : null; }
// Il codice di sincronizzazione arriva nell'intestazione x-giardino-code, così non finisce negli indirizzi (e nei log).
// ?code= resta accettato solo per le copie vecchie dell'app ancora aperte sui telefoni.
export const codiceDa = (request) => cleanCode(request.headers.get("x-giardino-code") || new URL(request.url).searchParams.get("code"));
export const siteUrl = (req) => (globalThis.Netlify?.env?.get("URL")) || new URL(req.url).origin;

/* ---------------- Dati ---------------- */
export const IMP_DEF = { bicchiere: 0.25, annaffiatoio: 5, ora_mattina: 7, ora_sera: 19 };
export const vuoto = () => ({ location: null, plants: [], impostazioni: { ...IMP_DEF }, vacanza: null, eventi: [], piano_claude: null, meteo_manual: null });
export const CAMPI = ["location", "plants", "impostazioni", "vacanza", "meteo_manual", "piano_claude"];

export async function leggi(st, code) {
  const f = await st.getWithMetadata("d-" + code, { type: "json" });
  if (!f || !f.data) return null;
  return { rev: f.data.rev || 0, updatedAt: f.data.updatedAt || 0, data: { ...vuoto(), ...(f.data.data || {}) }, etag: f.etag || null };
}
// Legge, applica fn(data) e scrive solo se nessun altro ha scritto nel frattempo (fino a 4 tentativi).
export async function aggiorna(st, code, fn) {
  for (let i = 0; i < 4; i++) {
    const cur = await leggi(st, code);
    const data = cur ? structuredClone(cur.data) : vuoto();
    const r = await fn(data);
    if (r === false) return cur;
    data.eventi = pota(data.eventi);
    const next = { rev: (cur?.rev || 0) + 1, updatedAt: Date.now(), data };
    const res = await st.setJSON("d-" + code, next, cur?.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return { ...next, etag: res?.etag };
  }
  throw new Error("Troppe modifiche nello stesso momento: riprova.");
}
export function pota(ev) {
  const lim = M.addDays(M.isoDate(new Date()), -400);
  const visti = new Set();
  return (Array.isArray(ev) ? ev : []).filter((e) => e && e.id && e.plantId && /^\d{4}-\d{2}-\d{2}$/.test(e.data || "") && e.data >= lim && !visti.has(e.id) && visti.add(e.id)).slice(-3000);
}

/* ---------------- Meteo (Open-Meteo) ----------------
   Due richieste in parallelo (vedi M.urlMeteo); il risultato resta nell'archivio 15 minuti, nella stessa ora:
   bot, Claude, Telegram e Siri lo condividono invece di richiederlo ogni volta (risposte più rapide, meno tempo di calcolo). */
const METEO_VALIDO = 15 * 60e3;
export async function meteo(lat, lon) {
  const key = `c-meteo-${(+lat).toFixed(2)},${(+lon).toFixed(2)}`, st = store(), ora = new Date();
  let c = null;
  try { c = await st.get(key, { type: "json" }); } catch (e) { console.warn("cache del meteo:", e?.message); }
  if (c && ora - c.at < METEO_VALIDO && new Date(c.at).getUTCHours() === ora.getUTCHours()) { M.registraClima(lat, M.climaDa(c.met)); return c.met; }
  const u = M.urlMeteo(lat, lon);
  // previsioni di base, più modelli insieme (ensemble) e storico dei giorni passati (una richiesta al giorno), in parallelo
  const [r, rMod, sto] = await Promise.all([fetch(u.base).catch((e) => ({ ok: false, status: e?.message || "rete" })), fetch(u.modelli).catch(() => null),
    storicoTemperature(st, lat, lon, oraLocale(c?.met?.tz || "Europe/Rome").oggi).catch(() => null)]);
  if (!r.ok) return meteoRiserva(st, key, lat, lon, c?.met, "Open-Meteo " + r.status);
  const j = await r.json(), jMod = rMod?.ok ? await rMod.json().catch(() => null) : null;
  const { oggi, ora: h } = oraLocale(j.timezone || "Europe/Rome");
  const met = M.componiMeteo(j, null, oggi, h, jMod);
  met.lat = lat; met.storico = sto?.temp || null; met.archivio = sto?.arch || null;
  M.registraClima(lat, M.climaDa(met));
  try { await st.setJSON(key, { at: ora.getTime(), met }); } catch (e) { console.warn("cache del meteo:", e?.message); }
  return met;
}
// Open-Meteo non risponde: previsioni da MET Norway; giorni passati, storico e (se di oggi) umidità del suolo dall'ultimo
// meteo buono salvato. Se non risponde nemmeno MET Norway, l'ultimo meteo buono così com'è (o l'errore).
const UA = "giardino-fede.netlify.app/1.0 https://giardino-fede.netlify.app";
async function meteoRiserva(st, key, lat, lon, ultimo, errore) {
  console.warn("meteo di riserva:", errore);
  try {
    const tz = ultimo?.tz || "Europe/Rome", { oggi, ora } = oraLocale(tz);
    const r = await fetch(M.urlMet(lat, lon), { headers: { "user-agent": UA } });
    if (!r.ok) throw new Error("MET Norway " + r.status);
    const { days, notte } = M.giorniDaMet(await r.json(), tz, lat, oggi, ora);
    if (!days.length) throw new Error("MET Norway senza dati");
    const met = { tz, lat, days: [...(ultimo?.days || []).filter((d) => d.date < oggi).slice(-3), ...days], suolo: null, notte, storico: ultimo?.storico || null, archivio: ultimo?.archivio || null, fonte: "MET Norway (riserva)" };
    M.registraClima(lat, M.climaDa(met));
    try { await st.setJSON(key, { at: Date.now(), met, riserva: true }); } catch {}
    return met;
  } catch (e) {
    console.warn("anche la riserva non risponde:", e?.message);
    if (ultimo) return { ...ultimo, fonte: "ultimo meteo salvato" };
    throw new Error(errore);
  }
}
/* ---------------- Pioggia misurata: stazioni ARPAE-SIMC (open data, Emilia-Romagna) ----------------
   realtime.jsonl (~9 MB) contiene le ultime ore di tutte le stazioni: il bot lo legge ogni 3 ore, tiene le ore della
   stazione con pluviometro più vicina (entro 15 km) e somma i giorni completi. B13011 = pioggia; timerange [1,0,3600]
   = ultima ora, [1,0,900] = ultimo quarto d'ora. Ore in UTC, alla fine dell'intervallo. */
export const ARPAE_URL = "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl";
export const inEmiliaRomagna = (lat, lon) => lat > 43.7 && lat < 45.15 && lon > 9.15 && lon < 12.85;
export function leggiArpae(testo, lat, lon, preferita) {
  const staz = new Map(), cosl = Math.cos(lat * Math.PI / 180), COORD = /"lon":\s*(-?\d+),\s*"lat":\s*(-?\d+)/;
  for (const l of testo.split("\n")) {
    if (!l.includes('"B13011"')) continue;
    // le coordinate sono all'inizio della riga: le stazioni lontane si scartano senza leggere tutta la riga
    // (prima si leggevano tutte le ~12.000 righe del file; ne servono poche decine)
    const c = COORD.exec(l.slice(0, 240));
    if (c && !(Math.hypot((c[2] / 1e5 - lat) * 111, (c[1] / 1e5 - lon) * 111 * cosl) <= 15)) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const la = o.lat / 1e5, lo = o.lon / 1e5, km = Math.hypot((la - lat) * 111, (lo - lon) * 111 * cosl);
    if (!(km <= 15)) continue;
    const k = `${o.network}|${o.lon}|${o.lat}`, s = staz.get(k) || { k, nome: "", km: +km.toFixed(1), h: {}, q: {} };
    for (const x of o.data || []) {
      if (x.vars?.B01019) s.nome = String(x.vars.B01019.v);
      const v = x.vars?.B13011?.v, tr = x.timerange;
      if (v == null || !tr || tr[0] !== 1) continue;
      if (tr[2] === 3600) s.h[o.date] = v; else if (tr[2] === 900) s.q[o.date] = v;
    }
    staz.set(k, s);
  }
  const conDati = [...staz.values()].filter((s) => Object.keys(s.h).length || Object.keys(s.q).length).sort((a, b) => a.km - b.km);
  const s = conDati.find((x) => x.k === preferita) || conDati[0];
  if (!s) return null;
  let ore = s.h;
  if (!Object.keys(ore).length) { ore = {}; for (const [t, v] of Object.entries(s.q)) { const f = new Date(Math.ceil(Date.parse(t) / 36e5) * 36e5).toISOString().replace(".000", ""); ore[f] = (ore[f] || 0) + v; } }
  return { stazione: { k: s.k, nome: s.nome || "stazione ARPAE", km: s.km }, ore, quarti: s.q };
}
// giorni locali completi (almeno 22 ore) dalle ore misurate
export function giorniMisurati(ore, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }), g = {};
  for (const [t, v] of Object.entries(ore || {})) { const d = fmt.format(new Date(Date.parse(t) - 30 * 60e3)); (g[d] ||= { mm: 0, n: 0 }); g[d].mm += +v || 0; g[d].n++; }
  return Object.fromEntries(Object.entries(g).filter(([, x]) => x.n >= 22).map(([d, x]) => [d, +x.mm.toFixed(1)]));
}
// Ore e quarti d'ora misurati per una posizione: archivio c-arpae-<lat,lon> (6 giorni), aggiornato con il file realtime.
export async function misureArpae(st, lat, lon, testo, { massimaEta = 0 } = {}) {
  const key = `c-arpae-${(+lat).toFixed(2)},${(+lon).toFixed(2)}`, prima = (await st.get(key, { type: "json" }).catch(() => null)) || { ore: {}, quarti: {} };
  if (massimaEta && prima.at && Date.now() - prima.at < massimaEta) return prima;
  if (testo == null) { try { const r = await fetch(ARPAE_URL, { headers: { "user-agent": UA } }); testo = r.ok ? await r.text() : ""; } catch (e) { console.warn("ARPAE:", e?.message); testo = ""; } }
  const letto = testo ? leggiArpae(testo, lat, lon, prima.stazione?.k) : null;
  if (!letto) return prima.stazione ? prima : null;
  const stessa = prima.stazione?.k === letto.stazione.k, limite = new Date(Date.now() - 6 * 864e5).toISOString();
  const unisci = (a, b) => Object.fromEntries(Object.entries({ ...(stessa ? a || {} : {}), ...b }).filter(([t]) => t >= limite));
  const c = { stazione: letto.stazione, ore: unisci(prima.ore, letto.ore), quarti: unisci(prima.quarti, letto.quarti), at: Date.now() };
  await st.setJSON(key, c).catch(() => {});
  return c;
}
// Ogni 3 ore (dal bot): aggiorna le ore misurate per ogni posizione in Emilia-Romagna e scrive i giorni completi nei dati.
export async function aggiornaPioggiaMisurata(st) {
  const { blobs } = await st.list({ prefix: "d-" });
  let testo = null;
  for (const b of blobs) {
    const code = b.key.slice(2), cur = await leggi(st, code), l = cur?.data?.location;
    if (!l || !inEmiliaRomagna(l.lat, l.lon)) continue;
    if (testo === null) { try { const r = await fetch(ARPAE_URL, { headers: { "user-agent": UA } }); testo = r.ok ? await r.text() : ""; } catch (e) { console.warn("ARPAE:", e?.message); testo = ""; } }
    if (!testo) return;
    const c = await misureArpae(st, l.lat, l.lon, testo);
    if (!c?.stazione) continue;
    const att = cur.data.pioggia_misurata, limite = M.addDays(M.isoDate(new Date()), -60), letto = c;
    const giorni = { ...Object.fromEntries(Object.entries(att?.stazione === letto.stazione.nome ? att.giorni || {} : {}).filter(([d]) => d >= limite)), ...giorniMisurati(c.ore, "Europe/Rome") };
    if (JSON.stringify(att?.giorni || {}) !== JSON.stringify(giorni) || att?.stazione !== letto.stazione.nome)
      await aggiorna(st, code, (d) => { d.pioggia_misurata = { stazione: letto.stazione.nome, km: letto.stazione.km, giorni, aggiornato: new Date().toISOString() }; });
  }
}
// Storico dei 400 giorni passati: temperature (fasi a gradi-giorno) e pioggia, evaporazione, sole (bilancio dell'acqua).
// Una richiesta al giorno, poi dall'archivio. Restituisce {temp, arch}.
async function storicoTemperature(st, lat, lon, oggi) {
  const key = `c-storico-${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;
  let c = null;
  try { c = await st.get(key, { type: "json" }); if (c?.giorno === oggi && c.temp && c.arch) return c; } catch {}
  try {
    const r = await fetch(M.urlStorico(lat, lon, oggi));
    if (r.ok) { const j = await r.json(), temp = M.storicoDa(j), arch = M.archivioDa(j);
      if (Object.keys(temp).length) { const x = { giorno: oggi, temp, arch }; await st.setJSON(key, x).catch(() => {}); return x; } }
  } catch (e) { console.warn("storico:", e?.message); }
  return c?.temp ? c : null;
}
export function oraLocale(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { oggi: `${p.year}-${p.month}-${p.day}`, ora: +p.hour };
}

/* ---------------- Piano attivo: quello di Claude se copre oggi, altrimenti il calcolo automatico ---------------- */
// ultimo giorno programmato da Claude (le previsioni del meteo arrivano a circa 7 giorni)
export function finePiano(pc) { let f = ""; for (const x of pc?.data?.piante || []) for (const g of x.giorni || []) if (g?.data > f) f = g.data; return f; }
export function pianoAttivo(data, met, oggi) {
  const lat = data.location?.lat, giorni = M.conPioggiaMisurata(met.days, data.pioggia_misurata, oggi);
  // giorni passati fino a 120: il bilancio dell'acqua parte dall'ultima innaffiatura o dall'ultimo controllo
  const past = M.giorniPassati({ ...met, lat: met.lat ?? lat }, data.pioggia_misurata, oggi), fut = giorni.filter((d) => d.date >= oggi).slice(0, 7);
  const base = M.pianoLocale({ piante: data.plants, past, fut, eventi: data.eventi, oggi, lat, vacanza: data.vacanza, suolo: met.suolo });
  const pc = data.piano_claude;
  if (pc?.data?.piante?.some((x) => x.giorni?.some((g) => g.data === oggi))) {
    const ids = new Set(pc.data.piante.map((x) => x.id));
    // oltre l'ultimo giorno del piano di Claude vale il calcolo automatico
    const piante = pc.data.piante.map((x) => { const b = base.piante.find((y) => y.id === x.id); if (!b) return x; const date = new Set((x.giorni || []).map((g) => g.data));
      return { ...x, giorni: [...(x.giorni || []), ...b.giorni.filter((g) => !date.has(g.data)).map((g) => ({ ...g, auto: true }))].sort((a, c) => (a.data < c.data ? -1 : 1)) }; });
    return { piano: { avvisi: pc.data.avvisi || [], sintesi: pc.data.sintesi || "", piante: [...piante, ...base.piante.filter((x) => !ids.has(x.id))] }, fonte: "Claude", past, fut, base, meteoFonte: met.fonte || "" };
  }
  return { piano: base, fonte: "calcolo automatico", past, fut, base, meteoFonte: met.fonte || "" };
}

/* ---------------- Telegram ---------------- */
export async function tg(token, method, payload, { ignora = false } = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {}) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { if (ignora) { console.warn(`Telegram ${method}: ${j.description || r.status}`); return null; } throw new Error(`Telegram ${method}: ${j.description || r.status}`); }
  return j.result;
}
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("it-IT");
export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const corto = (s) => { s = String(s || ""); return s.length > 18 ? s.slice(0, 17) + "…" : s; };
export const TIPI = { f: "fatto", s: "saltato", u: "umido", a: "secco", c: "concime" };
export const ETICHETTE = { fatto: "annaffiata", saltato: "saltata", umido: "terreno ancora umido", secco: "era secca, annaffiata", concime: "concimata" };
export const ESITI = ["fatto", "secco", "umido", "saltato"];
const conZona = (p) => M.zonaDi(p) ? ` <i>(${esc(M.zonaDi(p))})</i>` : "";
// Nei giorni di pioggia dice perché una pianta al coperto va bagnata lo stesso (altrimenti sembra un errore).
const POSTO = { interno: "in casa", serra: "in veranda/serra", riparato: "al riparo" };
export const notaPioggia = (p, giorno) => (giorno?.rain || 0) >= 1 && POSTO[p.dove] ? `${POSTO[p.dove]}: la pioggia non la raggiunge` : "";
// Pulsanti per una pianta: “Annaffiato” e “Terreno ancora umido” su righe intere (si leggono bene sul telefono);
// il nome serve solo se nel messaggio ci sono più piante; “Salto” solo nel messaggio del mattino.
export function pulsantiAcqua(p, oggi, { conNome = true, salto = true, secca = false } = {}) {
  const n = conNome ? " · " + corto(p.nome) : "";
  const r1 = [{ text: (secca ? "🏜 Era secca: annaffiato" : "✅ Annaffiato") + n, callback_data: `g|${oggi}|${p.id}|${secca ? "a" : "f"}` }];
  const r2 = [{ text: "💦 Terreno ancora umido", callback_data: `g|${oggi}|${p.id}|u` }];
  if (salto && !secca) r2.push({ text: "⏭ Salto", callback_data: `g|${oggi}|${p.id}|s` });
  return [r1, r2];
}

export function messaggioMattina(data, ap, oggi, { prova = false } = {}) {
  const imp = { ...IMP_DEF, ...(data.impostazioni || {}) }, d0 = ap.fut[0], lat = data.location?.lat;
  const righe = { innaffia: [], controlla: [], concime: [] }, tastiera = [], piante = M.pianteOrdinate(data.plants);
  const azione = (p) => ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((x) => x.data === oggi);
  const conNome = piante.filter((p) => ["innaffia", "controlla"].includes(azione(p)?.azione)).length > 1;
  for (const p of piante) {
    const g = azione(p);
    if (g?.azione === "innaffia") {
      const np = notaPioggia(p, d0);
      righe.innaffia.push(`💧 <b>${esc(p.nome)}</b>${conZona(p)}: ${fmt(g.litri, g.litri < 2 ? 2 : 1)} L (${esc(M.dose(g.litri, imp))}), ${esc(g.momento)}\n      <i>${esc(g.motivo)}${np ? " — " + esc(np) : ""}</i>`);
      tastiera.push(...pulsantiAcqua(p, oggi, { conNome }));
    } else if (g?.azione === "controlla") {
      righe.controlla.push(`👆 <b>${esc(p.nome)}</b>${conZona(p)}: ${esc(g.motivo)}`);
      tastiera.push(...pulsantiAcqua(p, oggi, { conNome, secca: true }));
    }
    const c = M.concime(p, { oggi, lat, eventi: data.eventi });
    if (c.inStagione && c.dovuto && !M.inVacanza(data.vacanza, oggi)) {
      righe.concime.push(`🌱 <b>${esc(p.nome)}</b>: ${esc(c.tipo)} (ogni ${c.freq} giorni)`);
      tastiera.push([{ text: "🌱 " + corto(p.nome) + " concimata", callback_data: `g|${oggi}|${p.id}|c` }]);
    }
  }
  const dataLunga = new Date(oggi + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  let msg = `🪴 <b>Giardino — ${esc(dataLunga)}</b>\n${esc(data.location?.name || "")} · ${esc(d0.cond)}, ${fmt(d0.tmin, 0)}–${fmt(d0.tmax, 0)} °C, pioggia ${fmt(d0.rain)} mm\n`;
  if (M.inVacanza(data.vacanza, oggi)) msg += `\n🧳 <i>Sei in vacanza fino al ${esc(new Date(data.vacanza.al + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "long" }))}: inoltra questo messaggio a chi bagna le piante.</i>\n`;
  if (righe.innaffia.length) msg += `\n<b>Da innaffiare</b>\n${righe.innaffia.join("\n")}\n`;
  if (righe.controlla.length) msg += `\n<b>Da controllare con un dito</b>\n${righe.controlla.join("\n")}\n`;
  if (righe.concime.length) msg += `\n<b>Da concimare</b>\n${righe.concime.join("\n")}\n`;
  const daFare = righe.innaffia.length + righe.controlla.length + righe.concime.length;
  if (!daFare) msg += `\nOggi non c'è niente da fare. 🌤\n`;
  for (const a of (ap.piano.avvisi || []).slice(0, 3)) msg += `\n⚠️ ${esc(a)}`;
  const prossimi = ap.fut.slice(1, 4).map((d) => { const n = piante.filter((p) => ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((g) => g.data === d.date && g.azione === "innaffia")).length;
    return new Date(d.date + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short" }) + " " + (n ? n + " 💧" : "–"); }).join(" · ");
  msg += `\n\nProssimi giorni: ${prossimi}`;
  if (tastiera.length && !prova) msg += `\n<i>Se non premi nulla, domani le conto come annaffiate.</i>`;
  msg += `\n<i>Piano: ${esc(ap.fonte)}${ap.meteoFonte ? " · meteo: " + esc(ap.meteoFonte) : ""}</i>`;
  return { msg, tastiera, daFare };
}

// Innaffiature notificate senza risposta: il giorno dopo si considerano fatte.
export function presunti(t, data, oggi) {
  const nuovi = [];
  for (const [d, lista] of Object.entries(t.notificati || {})) {
    if (d >= oggi) continue;
    for (const n of lista) {
      const risposto = data.eventi.some((e) => e.plantId === n.id && e.data === d && e.fonte !== "presunto");
      const id = `pres-${d}-${n.id}`;
      if (!risposto && !data.eventi.some((e) => e.id === id)) nuovi.push({ id, plantId: n.id, tipo: "fatto", data: d, fonte: "presunto", litri: n.litri ?? null });
    }
  }
  return nuovi;
}

/* ---------------- Altri messaggi ---------------- */
const dl = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric" });
export function messaggioSettimana(data, ap) {
  const imp = { ...IMP_DEF, ...(data.impostazioni || {}) };
  const L = [`📅 <b>Prossimi 7 giorni</b> · piano: ${esc(ap.fonte)}`];
  for (const p of M.pianteOrdinate(data.plants)) {
    const x = ap.piano.piante.find((y) => y.id === p.id); if (!x) continue;
    const g = x.giorni.filter((y) => y.azione !== "salta").map((y) => `${dl(y.data)} ${y.azione === "innaffia" ? fmt(y.litri, y.litri < 2 ? 2 : 1) + " L" : "👆"}`);
    L.push(`\n<b>${esc(p.nome)}</b>: ${g.length ? esc(g.join(" · ")) : "niente da fare"}`);
  }
  if (ap.piano.sintesi) L.push("\n" + esc(ap.piano.sintesi));
  L.push(`\n<i>👆 = controlla con un dito. Dosi in bicchieri da ${fmt(imp.bicchiere, 2)} L e annaffiatoi da ${fmt(imp.annaffiatoio)} L nel messaggio del giorno.</i>`);
  return L.join("\n");
}
// La correzione del consumo come la calcola il bilancio dell'acqua (la stessa che mostra l'app), anche quando il piano non
// è stato appena calcolato con questi eventi (riepilogo della domenica, connettore dopo una registrazione).
// Senza meteo resta la regola semplice.
export function calibrazioneVera(data, met, pid, oggi) {
  const p = data?.plants?.find((x) => x.id === pid);
  if (!p || !Array.isArray(met?.days)) return M.calibrazione(data?.eventi || [], pid, oggi);
  const lat = data.location?.lat, past = M.giorniPassati({ ...met, lat: met.lat ?? lat }, data.pioggia_misurata, oggi);
  return M.bilancioPassato(p, M.params(p, { oggi, lat }), past, data.eventi || [], oggi).k.calib;
}
export function riepilogoSettimana(data, oggi, met) {
  const lat = data.location?.lat, da = M.addDays(oggi, -6);
  const L = [`📊 <b>La settimana del giardino</b> (${esc(dl(da))} – ${esc(dl(oggi))})`];
  let tot = 0;
  for (const p of M.pianteOrdinate(data.plants)) {
    const e = M.eventiValidi(data.eventi, p.id).filter((x) => x.data >= da && x.data <= oggi), f = e.filter((x) => x.tipo === "fatto" || x.tipo === "secco");
    const litri = f.reduce((s, x) => s + (+x.litri || 0), 0); tot += litri;
    const um = e.filter((x) => x.tipo === "umido").length, se = e.filter((x) => x.tipo === "secco").length, cal = calibrazioneVera(data, met, p.id, oggi);
    let nota = ""; if (um) nota += ` · ${um}× era umida`; if (se) nota += ` · ${se}× era secca`; if (Math.abs(cal - 1) > 0.01) nota += ` · ora conto il ${Math.round(Math.abs(cal - 1) * 100)}% ${cal < 1 ? "in meno" : "in più"}`;
    L.push(`• <b>${esc(p.nome)}</b>: ${f.length} ${f.length === 1 ? "volta" : "volte"}, ${fmt(litri)} L${nota}`);
  }
  L.push(`\nTotale: <b>${fmt(tot)} L</b>`);
  const conc = M.pianteOrdinate(data.plants).map((p) => ({ p, c: M.concime(p, { oggi, lat, eventi: data.eventi }) })).filter((x) => x.c.inStagione && x.c.tra <= 7);
  if (conc.length) L.push("\n🌱 Concime nei prossimi giorni: " + conc.map((x) => esc(x.p.nome) + (x.c.tra <= 0 ? " (già da fare)" : " (tra " + x.c.tra + " g)")).join(", "));
  return L.join("\n");
}
export function backup(data) {
  return { app: "giardino", formato: 1, creato: new Date().toISOString(),
    giardino: { location: data.location, plants: data.plants, impostazioni: data.impostazioni, vacanza: data.vacanza, eventi_app: data.eventi },
    meteo: data.meteo_manual || null, piano: data.piano_claude || null };
}
export async function inviaFile(token, chat_id, nome, testo, didascalia) {
  const fd = new FormData();
  fd.append("chat_id", String(chat_id)); fd.append("caption", didascalia || "");
  fd.append("document", new Blob([testo], { type: "application/json" }), nome);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({})); if (!j.ok) throw new Error("Telegram sendDocument: " + (j.description || r.status));
}
// Il piano di Claude sta per finire (o è finito): messaggio con il pulsante per aprire Claude con la richiesta già scritta.
export function messaggioFinePiano(fine, oggi) {
  const quando = fine === oggi ? "finisce oggi" : fine > oggi ? "finisce domani" : "è finito " + dl(fine);
  const testo = `📅 <b>Il piano di Claude ${quando}</b>${fine >= oggi ? " (" + esc(dl(fine)) + ")" : ""}.\nOltre quel giorno non ha programmato perché le previsioni del meteo si fermavano lì: chiedigli di aggiornarlo.\n` +
    `Scrivigli: <i>«Fammi il piano di innaffiatura della settimana e salvalo.»</i>\nFinché non lo rifà, uso il calcolo automatico.`;
  const url = "https://claude.ai/new?q=" + encodeURIComponent("Fammi il piano di innaffiatura della settimana per il mio giardino e salvalo.");
  return { testo, tastiera: { inline_keyboard: [[{ text: "✨ Apri Claude", url }]] } };
}
/* ---------------- Crediti Netlify (stima) ----------------
   Piano Free: 300 crediti al mese. Ogni pubblicazione costa 15 crediti; le richieste di app, bot, Claude e Siri, con
   questo traffico, pochi crediti al mese (stima prudente: 5). Le pubblicazioni si contano dalle impronte di versione viste. */
export const CREDITI = { limite: 300, pubblicazione: 15, uso: 5, avviso: 240 };
export async function crediti(st) {
  const mese = oraLocale("Europe/Rome").oggi.slice(0, 7), key = "u-" + mese;
  const u = (await st.get(key, { type: "json" })) || { versioni: [], avvisato: false };
  if (!u.versioni.includes(VERSIONE)) { u.versioni.push(VERSIONE); await st.setJSON(key, u); }
  // con il valore vero letto su Netlify (correzione) la stima parte da lì: + 15 per ogni pubblicazione dopo, + l'uso dei giorni passati
  const k = u.correzione, giorni = k ? Math.max(0, (Date.now() - k.at) / 864e5) : 0;
  const stima = k ? Math.round(CREDITI.limite - k.rimasti + Math.max(0, u.versioni.length - k.versioni) * CREDITI.pubblicazione + giorni * CREDITI.uso / 30)
    : u.versioni.length * CREDITI.pubblicazione + CREDITI.uso;
  return { mese, pubblicazioni: u.versioni.length, stima, limite: CREDITI.limite, alto: stima >= CREDITI.avviso, avvisato: !!u.avvisato, corretta: k ? { rimasti: k.rimasti, at: k.at } : null, key };
}
export async function correggiCrediti(st, rimasti) {
  const c = await crediti(st), u = (await st.get(c.key, { type: "json" })) || { versioni: [] };
  u.correzione = { rimasti, at: Date.now(), versioni: u.versioni.length };
  await st.setJSON(c.key, u);
  return crediti(st);
}
export async function segnaAvvisoCrediti(st, c) { const u = (await st.get(c.key, { type: "json" })) || { versioni: [] }; u.avvisato = true; await st.setJSON(c.key, u); }
export const COMANDI = [
  { command: "oggi", description: "Il piano di oggi, con i pulsanti" },
  { command: "fatto", description: "Segna come annaffiate le piante di oggi (es. /fatto balcone, /fatto aglio)" },
  { command: "settimana", description: "I prossimi 7 giorni" },
  { command: "vacanza", description: "Es. /vacanza 10/8 20/8 oppure /vacanza no" },
  { command: "aiuto", description: "Cosa sa fare il bot" }
];

/* ---------------- “Fatto” per tutte le piante di oggi (comando /fatto e Siri) ---------------- */
// Segna come annaffiate le piante che oggi il piano dice di innaffiare (tutte o di una zona) e che non hanno già una risposta.
// Con «pianta» (id) segna quella pianta anche se oggi il piano non la prevedeva (l'hai annaffiata di tua iniziativa).
export async function segnaFatte(st, code, ap, oggi, { zona = "", pianta = "", fonte = "telegram" } = {}) {
  const z = String(zona || "").trim().toLowerCase(), fatte = [];
  await aggiorna(st, code, (d) => {
    fatte.length = 0;
    for (const p of M.pianteOrdinate(d.plants)) {
      if (pianta ? p.id !== pianta : z && M.zonaDi(p).toLowerCase() !== z) continue;
      const g = ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((x) => x.data === oggi);
      if ((!pianta && g?.azione !== "innaffia") || d.eventi.some((e) => e.plantId === p.id && e.data === oggi && ESITI.includes(e.tipo))) continue;
      const litri = g?.azione === "innaffia" ? g.litri : +(M.params(p, { oggi, lat: d.location?.lat, eventi: d.eventi }).rawL * 1.1).toFixed(2);
      d.eventi.push({ id: `${fonte === "siri" ? "sr" : "tg"}-f-${oggi}-${p.id}`, plantId: p.id, tipo: "fatto", data: oggi, fonte, ts: new Date().toISOString(), litri });
      fatte.push(p.nome);
    }
    if (!fatte.length) return false;
  });
  return fatte;
}
// Da un testo libero («balcone», «aglio»): prima una zona, poi una pianta (nome uguale, poi che inizia così, poi che lo contiene).
export function trovaZonaOPianta(plants, testo) {
  const q = String(testo || "").trim().toLowerCase(); if (!q) return {};
  const zona = plants.map(M.zonaDi).find((z) => z && z.toLowerCase() === q);
  if (zona) return { zona };
  const p = plants.find((x) => x.nome.toLowerCase() === q) || plants.find((x) => x.nome.toLowerCase().startsWith(q)) || plants.find((x) => x.nome.toLowerCase().includes(q));
  return p ? { pianta: p.id, nome: p.nome } : { nessuno: true };
}
// Testo da far leggere a Siri: cosa innaffiare oggi (tutte le piante o una zona).
const parlato = (s) => String(s).replace(/≈\s*/g, "circa ").replace(/(\d)½/g, "$1 e mezzo").replace(/½/g, "mezzo").replace(/¼/g, "un quarto").replace(/¾/g, "tre quarti");
export function testoOggi(data, ap, oggi, { zona = "" } = {}) {
  const imp = { ...IMP_DEF, ...(data.impostazioni || {}) }, z = String(zona || "").trim().toLowerCase();
  const inn = [], ctrl = []; let fatte = 0;
  for (const p of M.pianteOrdinate(data.plants)) {
    if (z && M.zonaDi(p).toLowerCase() !== z) continue;
    const g = ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((x) => x.data === oggi);
    const segnata = data.eventi.some((e) => e.plantId === p.id && e.data === oggi && ESITI.includes(e.tipo));
    if (g?.azione === "innaffia") { if (segnata) fatte++; else inn.push(`${p.nome}, ${fmt(g.litri, g.litri < 2 ? 2 : 1)} litri, ${parlato(M.dose(g.litri, imp))}`); }
    else if (g?.azione === "controlla" && !segnata) ctrl.push(p.nome);
  }
  const out = [];
  if (inn.length) out.push("Da innaffiare oggi: " + inn.join("; ") + ".");
  if (ctrl.length) out.push("Da controllare con un dito: " + ctrl.join(", ") + ".");
  if (!out.length) out.push(fatte ? "Hai già innaffiato tutto quello che serviva oggi." : "Oggi non c'è niente da innaffiare" + (zona ? " in " + zona : "") + ".");
  return out.join(" ");
}
