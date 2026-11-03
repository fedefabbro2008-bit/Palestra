// Giardino · parti condivise dalle funzioni Netlify (dati, connettore MCP, bot Telegram).
// Archivio: Netlify Blobs, store "giardino"
//   d-<codice>    { rev, updatedAt, data }   dati dell'app (piante, posizione, impostazioni, vacanza, eventi, piano di Claude)
//   m-<codice>    { token, at, write }       chiave del connettore per Claude
//   r-<chiave>    { code }                   dalla chiave del connettore al codice
//   t-<codice>    { token, secret, chat_id, username, tz, ultimo_invio, ultimo_avviso_sera, notificati }   bot Telegram
//   w-<segreto>   { code }                   dal webhook di Telegram al codice
import { getStore } from "@netlify/blobs";
import * as M from "./modello.mjs";
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

/* ---------------- Meteo (Open-Meteo) ---------------- */
const COND = (c) => c === 0 ? "sereno" : c <= 2 ? "poco nuvoloso" : c === 3 ? "nuvoloso" : (c === 45 || c === 48) ? "nebbia" : c >= 95 ? "temporale" : ((c >= 71 && c <= 77) || c === 85 || c === 86) ? "neve" : "pioggia";
export async function meteo(lat, lon) {
  const q = new URLSearchParams({ latitude: lat, longitude: lon, timezone: "auto", past_days: "3", forecast_days: "8",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max" });
  const r = await fetch("https://api.open-meteo.com/v1/forecast?" + q);
  if (!r.ok) throw new Error("Open-Meteo " + r.status);
  const j = await r.json(), d = j.daily, tz = j.timezone || "Europe/Rome";
  const out = { tz, days: d.time.map((t, i) => ({ date: t, cond: COND(d.weather_code[i]), tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
    rain: d.precipitation_sum[i] ?? 0, prob: d.precipitation_probability_max[i], et0: d.et0_fao_evapotranspiration[i] ?? 0, wind: d.wind_speed_10m_max[i] })), suolo: null, notte: null };
  // dati orari (umidità del suolo, temperature della notte) in una richiesta a parte: se non arrivano, il resto funziona lo stesso
  try {
    const r2 = await fetch("https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({ latitude: lat, longitude: lon, timezone: "auto", forecast_days: "2", hourly: M.ORARIO_PARAMS }));
    if (r2.ok) { const { oggi, ora } = oraLocale(tz); Object.assign(out, M.datiOrari((await r2.json()).hourly, oggi, ora)); }
  } catch (e) { console.warn("dati orari non disponibili:", e?.message); }
  return out;
}
export function oraLocale(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { oggi: `${p.year}-${p.month}-${p.day}`, ora: +p.hour };
}

/* ---------------- Piano attivo: quello di Claude se copre oggi, altrimenti il calcolo automatico ---------------- */
export function pianoAttivo(data, met, oggi) {
  const lat = data.location?.lat, past = met.days.filter((d) => d.date < oggi).slice(-3), fut = met.days.filter((d) => d.date >= oggi).slice(0, 7);
  const base = M.pianoLocale({ piante: data.plants, past, fut, eventi: data.eventi, oggi, lat, vacanza: data.vacanza, suolo: met.suolo });
  const pc = data.piano_claude;
  if (pc?.data?.piante?.some((x) => x.giorni?.some((g) => g.data === oggi))) {
    const ids = new Set(pc.data.piante.map((x) => x.id));
    return { piano: { avvisi: pc.data.avvisi || [], sintesi: pc.data.sintesi || "", piante: [...pc.data.piante, ...base.piante.filter((x) => !ids.has(x.id))] }, fonte: "Claude", past, fut, base };
  }
  return { piano: { ...base, sintesi: "" }, fonte: "calcolo automatico", past, fut, base };
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
      righe.innaffia.push(`💧 <b>${esc(p.nome)}</b>${conZona(p)}: ${fmt(g.litri, g.litri < 2 ? 2 : 1)} L (${esc(M.dose(g.litri, imp))}), ${esc(g.momento)}\n      <i>${esc(g.motivo)}</i>`);
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
  msg += `\n<i>Piano: ${esc(ap.fonte)}</i>`;
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
export function riepilogoSettimana(data, oggi) {
  const lat = data.location?.lat, da = M.addDays(oggi, -6);
  const L = [`📊 <b>La settimana del giardino</b> (${esc(dl(da))} – ${esc(dl(oggi))})`];
  let tot = 0;
  for (const p of M.pianteOrdinate(data.plants)) {
    const e = M.eventiValidi(data.eventi, p.id).filter((x) => x.data >= da && x.data <= oggi), f = e.filter((x) => x.tipo === "fatto" || x.tipo === "secco");
    const litri = f.reduce((s, x) => s + (+x.litri || 0), 0); tot += litri;
    const um = e.filter((x) => x.tipo === "umido").length, se = e.filter((x) => x.tipo === "secco").length, cal = M.calibrazione(data.eventi, p.id, oggi);
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
export const COMANDI = [
  { command: "oggi", description: "Il piano di oggi, con i pulsanti" },
  { command: "fatto", description: "Segna come annaffiate le piante di oggi (es. /fatto balcone)" },
  { command: "settimana", description: "I prossimi 7 giorni" },
  { command: "vacanza", description: "Es. /vacanza 10/8 20/8 oppure /vacanza no" },
  { command: "aiuto", description: "Cosa sa fare il bot" }
];

/* ---------------- “Fatto” per tutte le piante di oggi (comando /fatto e Siri) ---------------- */
// Segna come annaffiate le piante che oggi il piano dice di innaffiare (tutte o di una zona) e che non hanno già una risposta.
export async function segnaFatte(st, code, ap, oggi, { zona = "", fonte = "telegram" } = {}) {
  const z = String(zona || "").trim().toLowerCase(), fatte = [];
  await aggiorna(st, code, (d) => {
    fatte.length = 0;
    for (const p of M.pianteOrdinate(d.plants)) {
      if (z && M.zonaDi(p).toLowerCase() !== z) continue;
      const g = ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((x) => x.data === oggi);
      if (g?.azione !== "innaffia" || d.eventi.some((e) => e.plantId === p.id && e.data === oggi && ESITI.includes(e.tipo))) continue;
      d.eventi.push({ id: `${fonte === "siri" ? "sr" : "tg"}-f-${oggi}-${p.id}`, plantId: p.id, tipo: "fatto", data: oggi, fonte, ts: new Date().toISOString(), litri: g.litri });
      fatte.push(p.nome);
    }
    if (!fatte.length) return false;
  });
  return fatte;
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
