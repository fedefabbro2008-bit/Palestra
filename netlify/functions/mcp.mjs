import { getStore } from "@netlify/blobs";

/* Palestra · server MCP (Model Context Protocol) per Claude.
   Claude (claude.ai, app, Desktop) lo aggiunge come "connettore personalizzato" e legge da solo scheda e allenamenti
   sincronizzati: niente copia e incolla del riepilogo. Se l'utente lo permette nell'app («Claude può modificare la
   scheda»), Claude cambia anche la SCHEDA (modifica_scheda, annulla_modifica); lo storico resta sempre in sola lettura.

   Indirizzo:  https://<sito>/mcp/<CHIAVE>              (la chiave nell'indirizzo, "Nessun accesso")
         o:    https://<sito>/mcp  +  "Authorization: Bearer <CHIAVE>" nelle Request headers (la chiave non è nell'indirizzo)
   La chiave si crea, si cambia e si revoca dall'app (Impostazioni), cioè solo da chi ha il codice di sincronizzazione
   (vedi sync.mjs, op=mcp). È casuale e diversa dal codice: chi la conosce legge e non risale al codice; scrive solo
   sulla scheda e solo col permesso acceso. Ogni modifica lascia nei dati il segno "claude": l'app la mostra con Annulla.

   Trasporto: Streamable HTTP senza sessioni (ogni richiesta sta da sola), risposte JSON; niente stream SSE (GET -> 405).
   I calcoli seguono le regole dell'app (index.html): serie di lavoro senza riscaldamenti (R), muscolo secondario ½,
   stretching e riscaldamenti generici ("Altro") esclusi dalle serie per muscolo, drop set esclusi dai record,
   esercizi "per lato" che contano i due lati nel peso sollevato. */

export const config = { path: ["/mcp", "/mcp/*"] };

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TOKEN_RE = /^[A-Z2-7]{26}$/;
const TZ = "Europe/Rome";   // le date dell'app sono quelle del telefono, in Italia
const MAX_OUT = 60000;      // caratteri per risposta: oltre, si taglia (e lo si dice)
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS, ...extra } });
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });

/* ---------------- regole dell'app (index.html) ---------------- */
const MUSCLES = ["Petto", "Schiena", "Spalle", "Bicipiti", "Tricipiti", "Addominali", "Quadricipiti", "Femorale", "Glutei", "Polpacci", "Altro"];
const TARGET = { Petto: [10, 20], Schiena: [10, 20], Spalle: [8, 16], Bicipiti: [6, 14], Tricipiti: [6, 14], Addominali: [6, 12], Quadricipiti: [8, 16], Femorale: [6, 12], Glutei: [6, 12], Polpacci: [6, 12] };
const TYPES = { reps: { unit: "", word: "rip" }, time: { unit: "s", word: "s" }, dist: { unit: "m", word: "m" } };
const KINDS = { f: "F", d: "D", a: "A" };
const PHASE_LBL = { warm: "Riscaldamento", main: "Allenamento", cool: "Stretching" };
const SIDE_RX = /\bper\s+lato\b/i;
const num = (v) => { const n = parseFloat(typeof v === "string" ? v.replace(",", ".") : v); return Number.isFinite(n) ? n : 0; };
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const sideOf = (e) => typeof e.perSide === "boolean" ? e.perSide : SIDE_RX.test(String(e.name || ""));
const secOf = (e) => { const m = e.muscle, x = e.secondary; return x && x !== "Altro" && x !== m && MUSCLES.includes(x) && m !== "Altro" && MUSCLES.includes(m) ? x : null; };
const work = (det) => det.filter((d) => !d.w);
const main = (det) => work(det).filter((d) => d.t !== "d");
const tonOf = (det, type, side) => det.reduce((a, d) => a + d.kg * (type === "reps" ? d.val : 1), 0) * (side ? 2 : 1);
const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const fn = (n) => { n = num(n); return Number.isInteger(n) ? String(n) : String(+n.toFixed(2)).replace(".", ","); };
const fmtTon = (kg) => kg >= 1000 ? (kg / 1000).toFixed(1).replace(".", ",") + " t" : Math.round(kg) + " kg";
const fmtMin = (m) => { m = Math.round(m); return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0"); };
const WD = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const dm = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const dmy = (iso) => dm(iso) + "/" + iso.slice(0, 4);
const utc = (iso) => new Date(iso + "T00:00:00Z");
const isoU = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = utc(iso); d.setUTCDate(d.getUTCDate() + n); return isoU(d); };
const mondayOf = (iso) => addDays(iso, -((utc(iso).getUTCDay() + 6) % 7));
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const isoAt = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
const todayIso = () => isoAt(Date.now());
const hhmm = (ts) => new Intl.DateTimeFormat("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
const validIso = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && isoU(utc(x)) === x;
const setTxt = (d, type) => (d.kg > 0 ? fn(d.kg) + "×" : "") + fn(d.val) + (TYPES[type] || TYPES.reps).unit;
const e1rm = (det, type) => { if (type !== "reps") return 0; let b = 0; for (const d of main(det)) { if (d.kg > 0 && d.val >= 1 && d.val <= 12) { const v = d.val === 1 ? d.kg : d.kg * (1 + d.val / 30); if (v > b) b = v; } } return Math.round(b * 10) / 10; };
const exKey = (e) => e.exId ? "id:" + e.exId : "n:" + fold(e.name);

/* storico come lo salva l'app (forma compatta) -> allenamenti completi, dal più vecchio */
function readSessions(data) {
  const out = [];
  const logs = data && data.logs && typeof data.logs === "object" && !Array.isArray(data.logs) ? data.logs : {};
  for (const iso of Object.keys(logs)) {
    if (!validIso(iso) || !Array.isArray(logs[iso])) continue;
    for (const s of logs[iso]) {
      if (!s || typeof s !== "object" || !Array.isArray(s.entries)) continue;
      const entries = [];
      for (const e of s.entries) {
        if (!e || typeof e !== "object") continue;
        const type = own(TYPES, e.type) ? e.type : "reps";
        const detail = (Array.isArray(e.detail) ? e.detail : []).filter((d) => d && typeof d === "object").map((d) => ({
          kg: Math.max(0, num(d.kg)), val: Math.max(0, num(d.val !== undefined ? d.val : d.reps)),
          rpe: num(d.rpe) >= 1 && num(d.rpe) <= 10 ? num(d.rpe) : null, at: num(d.at) || null,
          w: !!d.w, t: !d.w && own(KINDS, d.t) ? d.t : "" }));
        if (!detail.length) continue;
        const x = { exId: e.exId ? String(e.exId) : null, name: String(e.name == null ? "Esercizio" : e.name).trim() || "Esercizio",
          muscle: MUSCLES.includes(e.muscle) ? e.muscle : "Altro", secondary: MUSCLES.includes(e.secondary) ? e.secondary : null, type, detail };
        if (typeof e.perSide === "boolean") x.perSide = e.perSide;
        x.side = sideOf(x);
        x.sets = work(detail).length;
        x.ton = tonOf(detail, type, x.side);
        entries.push(x);
      }
      out.push({ iso, id: String(s.id), dayKey: String(s.dayKey), dayName: String(s.dayName || ("Giorno " + s.dayKey)), forDay: s.forDay != null ? String(s.forDay) : null,
        startedAt: num(s.startedAt), endedAt: num(s.endedAt) || null, note: typeof s.note === "string" ? s.note : "", entries });
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.startedAt - b.startedAt);
}
const sessMin = (s) => s.endedAt && s.startedAt && s.endedAt > s.startedAt ? Math.min(240, (s.endedAt - s.startedAt) / 60000) : 0;
const workSets = (s) => s.entries.reduce((a, e) => a + (e.muscle !== "Altro" ? e.sets : 0), 0);
const sessTon = (s) => s.entries.reduce((a, e) => a + e.ton, 0);
function stats(sessions, from, to) {
  const r = { n: 0, min: 0, ton: 0, sets: 0, vol: Object.fromEntries(MUSCLES.map((m) => [m, 0])) };
  for (const s of sessions) {
    if (s.iso < from || s.iso > to) continue;
    r.n++; r.min += sessMin(s); r.ton += sessTon(s); r.sets += workSets(s);
    for (const e of s.entries) { r.vol[e.muscle] += e.sets; const sm = secOf(e); if (sm) r.vol[sm] += e.sets * 0.5; }
  }
  return r;
}
function streak(sessions, today) {
  const days = new Set(sessions.map((s) => s.iso));
  let n = 0;
  for (let w = 0; w < 104; w++) {
    const mon = addDays(mondayOf(today), -7 * w);
    let hit = false; for (let i = 0; i < 7 && !hit; i++) hit = days.has(addDays(mon, i));
    if (hit) n++; else if (w === 0) continue; else break;
  }
  return n;
}
/* record battuti nel periodo: ogni seduta contro quelle PRIMA (mai la prima volta), come in Settimana/Mese */
function records(sessions, from, to) {
  const best = {}, rec = {};
  for (const s of sessions) {
    if (s.iso > to) break;
    for (const e of s.entries) {
      if (e.muscle === "Altro") continue;
      const w = main(e.detail); if (!w.length) continue;
      let top = null, bw = 0;
      for (const d of w) { if (!top || d.kg > top.kg || (d.kg === top.kg && d.val > top.val)) top = d; if (d.kg === 0 && d.val > bw) bw = d.val; }
      const k = exKey(e), b = best[k];
      if (b && s.iso >= from) {
        const u = (TYPES[e.type] || TYPES.reps).word;
        if (top.kg > 0 && (top.kg > b.kg || (top.kg === b.kg && top.val > b.valAtKg)))
          rec[k] = { name: e.name, iso: s.iso, txt: setTxt(top, e.type), gain: top.kg > b.kg ? "+" + fn(top.kg - b.kg) + " kg" : "+" + fn(top.val - b.valAtKg) + " " + u };
        else if (b.kg === 0 && bw > b.val) rec[k] = { name: e.name, iso: s.iso, txt: fn(bw) + " " + u, gain: "+" + fn(bw - b.val) + " " + u };
      }
      if (!b) best[k] = { kg: top.kg, valAtKg: top.val, val: bw };
      else { if (top.kg > b.kg || (top.kg === b.kg && top.val > b.valAtKg)) { b.kg = top.kg; b.valAtKg = top.val; } if (bw > b.val) b.val = bw; }
    }
  }
  return Object.values(rec).sort((a, b) => b.iso.localeCompare(a.iso));
}
/* esercizio fermo: nessun progresso nelle ultime 3 sedute rispetto al meglio di prima (stessa regola dell'app) */
function perfOf(e) {
  const w = main(e.detail); if (!w.length) return null;
  const hasKg = w.some((d) => d.kg > 0), topKg = Math.max(...w.map((d) => d.kg));
  const best = !hasKg ? Math.max(...w.map((d) => d.val)) : e.type === "reps" ? Math.max(...w.map((d) => d.kg * (1 + d.val / 30)))
    : topKg * 1e6 + Math.max(...w.filter((d) => d.kg === topKg).map((d) => d.val));
  return { best, vol: w.reduce((a, d) => a + (d.kg > 0 ? d.kg * d.val : d.val), 0), hasKg, topKg };
}
function stallOf(items, today) {
  let P = items.map(({ iso, e }) => ({ iso, p: perfOf(e), type: e.type })).filter((x) => x.p);
  if (!P.length) return null;
  P = P.filter((x) => x.type === P[P.length - 1].type);
  if (P.length < 4) return null;
  const prevTop = Math.max(...P.slice(0, -1).map((x) => x.p.topKg));
  if (P.slice(-2).some((x) => x.p.hasKg && prevTop > 0 && x.p.topKg <= prevTop * 0.93)) return null;
  const last3 = P.slice(-3), kind = last3[2].p.hasKg;
  if (last3.some((x) => x.p.hasKg !== kind)) return null;
  const ref = P.slice(0, -3).filter((x) => x.p.hasKg === kind); if (!ref.length) return null;
  const bb = Math.max(...ref.map((x) => x.p.best)), vb = Math.max(...ref.map((x) => x.p.vol));
  if (Math.max(...last3.map((x) => x.p.best)) > bb * 1.005 || Math.max(...last3.map((x) => x.p.vol)) > vb * 1.005) return null;
  if (daysBetween(last3[2].iso, today) > 42) return null;   // fermo da 6 settimane: non "in stallo", solo non fatto
  return { since: last3[0].iso, lastIso: last3[2].iso };
}
function byExercise(sessions) {
  const idx = new Map();
  for (const s of sessions) for (const e of s.entries) {
    const k = exKey(e);
    if (!idx.has(k)) idx.set(k, { key: k, name: e.name, muscle: e.muscle, type: e.type, items: [] });
    const v = idx.get(k); v.name = e.name; v.muscle = e.muscle; v.type = e.type; v.items.push({ iso: s.iso, e });
  }
  return [...idx.values()];
}
function bestSet(v) {
  let b = null;
  for (const { iso, e } of v.items) for (const d of main(e.detail)) if (!b || d.kg > b.kg || (d.kg === b.kg && d.val > b.val)) b = { kg: d.kg, val: d.val, iso };
  return b;
}
function planLabel(e) {
  const w = Math.max(0, Math.round(num(e.warmups))), n = Math.max(0, Math.round(num(e.sets))), r = String(e.reps == null ? "" : e.reps).trim();
  const unit = /^\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?$/.test(r) ? (TYPES[e.type] || TYPES.reps).unit : "";
  return (w ? w + "R" + (n ? " + " : "") : "") + (n ? n + "×" + (r || "?") + unit : (r ? " × " + r + unit : ""));
}
const planDays = (data) => {
  const days = data && data.days && typeof data.days === "object" && !Array.isArray(data.days) ? data.days : {};
  return Object.keys(days).filter((k) => own(days, k) && days[k] && typeof days[k] === "object" && Array.isArray(days[k].exercises))
    .map((k) => ({ key: k, name: String(days[k].name || "Giorno " + k), spare: !!days[k].spare, exercises: days[k].exercises.filter((e) => e && typeof e === "object") }));
};
const clamp = (v, lo, hi, def) => { const n = Math.round(num(v)); return v == null || v === "" || !Number.isFinite(n) ? def : Math.min(hi, Math.max(lo, n)); };
const cut = (t) => t.length > MAX_OUT ? t.slice(0, MAX_OUT) + "\n\n[…risposta tagliata: chiedi un periodo più breve o un limite più basso]" : t;

/* ---------------- modifiche alla scheda (solo se l'utente lo permette nell'app) ----------------
   Le stesse regole dell'app (index.html: sanitizeDays, cleanPlanEx, applyPhase, normalizeLinks, id degli esercizi):
   la scheda che si salva qui è identica a quella che l'app ricava dagli stessi dati, così alla sincronizzazione non
   risultano cambiamenti che nessuno ha fatto. Lo storico degli allenamenti non si tocca mai. */
const PHASES = ["warm", "main", "cool"];
const PHASE_RX = { warm: /^\s*riscaldamento\s*[·:\-–—]\s*/i, cool: /^\s*stre?t?ching\s*[·:\-–—]\s*/i };
function inferPhase(e) {
  const n = String((e && e.name) || "");
  if (PHASE_RX.warm.test(n)) return "warm";
  if (PHASE_RX.cool.test(n)) return "cool";
  if (e && e.muscle === "Altro" && !(num(e.sets) > 0) && num(e.warmups) > 0) return "warm";
  return "main";
}
const phaseOf = (e) => e && PHASES.includes(e.phase) ? e.phase : inferPhase(e);
function applyPhase(e) {
  if (PHASES.includes(e.phase)) return;
  const ph = inferPhase(e); e.phase = ph;
  const rx = PHASE_RX[ph];
  if (rx && rx.test(e.name)) { const n = String(e.name).replace(rx, "").trim(); if (n) e.name = n.charAt(0).toUpperCase() + n.slice(1); }
}
function tidySide(e) { if (typeof e.perSide !== "boolean" || e.perSide === SIDE_RX.test(String(e.name || ""))) delete e.perSide; return e; }
function cleanPlanEx(e) {
  applyPhase(e);
  const w = Math.min(5, Math.max(0, Math.round(num(e.warmups)) || 0));
  if (w) e.warmups = w; else delete e.warmups;
  e.sets = Math.min(30, Math.max(w ? 0 : 1, Math.round(num(e.sets)) || (w ? 0 : 1)));
  e.kg = Math.max(0, num(e.kg));
  e.rest = Math.min(3600, Math.max(0, Math.round(num(e.rest))));
  e.reps = e.reps == null ? "" : String(e.reps);
  e.name = String(e.name == null ? "" : e.name).trim() || "Esercizio";
  return tidySide(e);
}
/* sezioni in ordine (riscaldamento, allenamento, stretching) senza spezzare superset e circuiti */
function normalizeLinks(day) {
  const ex = day.exercises;
  if (ex.length > 1) {
    const groups = []; let g = [];
    ex.forEach((e, i) => { g.push(e); if (!e.linkNext || i === ex.length - 1) { groups.push(g); g = []; } });
    groups.forEach((gr) => { const ph = phaseOf(gr[0]); gr.forEach((e) => { e.phase = ph; }); });
    const sorted = groups.map((gr, i) => ({ gr, i })).sort((a, b) => PHASES.indexOf(a.gr[0].phase) - PHASES.indexOf(b.gr[0].phase) || a.i - b.i);
    if (sorted.some((x, i) => x.i !== i)) day.exercises = [].concat(...sorted.map((x) => x.gr));
  }
  if (day.exercises.length) day.exercises[day.exercises.length - 1].linkNext = false;
}
function guessType(reps) {
  const s = String(reps || "");
  if (/\b\d+\s*(s|sec|secondi)\b/i.test(s) || /hold|plank/i.test(s)) return "time";
  if (/\b\d+\s*(m|km|metri)\b/i.test(s)) return "dist";
  return "reps";
}
const okKey = (k) => typeof k === "string" && k !== "" && !(k in Object.prototype);
const newId = () => "x" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-3);
function sanitizeDays(raw) {
  const days = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return days;
  Object.keys(raw).forEach((k) => {
    if (!okKey(k)) return;
    const d = raw[k];
    if (!d || typeof d !== "object" || Array.isArray(d)) return;
    days[k] = { name: d.name ? String(d.name) : "Giorno " + k, ...(d.spare ? { spare: true } : {}),
      exercises: (Array.isArray(d.exercises) ? d.exercises : []).filter((x) => x && typeof x === "object" && x.name).map((x) => cleanPlanEx({
        id: (x.id != null && typeof x.id !== "object" && x.id !== "") ? String(x.id) : newId(), name: String(x.name),
        muscle: MUSCLES.includes(x.muscle) ? x.muscle : "Altro",
        secondary: MUSCLES.includes(x.secondary) ? x.secondary : null,
        type: own(TYPES, x.type) ? x.type : guessType(x.reps),
        sets: num(x.sets) || (num(x.warmups) >= 1 && x.sets != null && x.sets !== "" ? 0 : 3), warmups: num(x.warmups),
        reps: String(x.reps == null ? "" : x.reps), kg: num(x.kg), rest: num(x.rest),
        linkNext: !!x.linkNext, ...(PHASES.includes(x.phase) ? { phase: x.phase } : {}), ...(typeof x.perSide === "boolean" ? { perSide: x.perSide } : {}) })) };
    normalizeLinks(days[k]);
  });
  return days;
}
/* impronta della scheda, la stessa dell'app (daysHash): così l'app riconosce la scheda scritta da Claude */
function stableStr(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(stableStr).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stableStr(v[k])).join(",") + "}";
}
function hsh(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + "." + str.length.toString(36); }
const daysHash = (d) => hsh(stableStr(d));
const normName = (n) => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
const dayShort = (name) => String(name).split(/\s*[·|]\s*|\s+[–—-]\s+/)[0].trim() || String(name);

/* id degli esercizi come nell'app: stesso nome di uno già in scheda -> stesso esercizio (storico unico);
   altrimenti l'id con cui compare nello storico, se nessun esercizio della scheda lo usa; altrimenti nuovo */
function idForName(days, sessions, name) {
  const k = normName(name), planIds = new Set();
  for (const d of Object.values(days)) for (const e of d.exercises) { if (normName(e.name) === k) return e.id; planIds.add(e.id); }
  for (let i = sessions.length - 1; i >= 0; i--) for (const en of sessions[i].entries) if (en.exId && normName(en.name) === k && !planIds.has(en.exId)) return en.exId;
  return newId();
}
/* rinominato (regola dell'app): con il nome di un altro esercizio della scheda diventa quello; una copia rinominata di
   un esercizio presente in più giornate diventa un esercizio a sé; altrimenti resta lo stesso (storico unito) */
function renameId(days, e) {
  let twin = null, shared = false;
  for (const d of Object.values(days)) for (const x of d.exercises) {
    if (x === e) continue;
    if (!twin && normName(x.name) === normName(e.name)) twin = x;
    if (x.id === e.id && normName(x.name) !== normName(e.name)) shared = true;
  }
  if (twin) e.id = twin.id; else if (shared) e.id = newId();
}
function nextDayKey(days, data) {
  // anche le lettere che compaiono nello storico sono usate: la giornata nuova non eredita date e rotazione di una tolta
  const used = new Set(Object.keys(days)), logs = data && data.logs && typeof data.logs === "object" ? data.logs : {};
  Object.values(logs).forEach((a) => { if (Array.isArray(a)) a.forEach((s) => { if (s && s.dayKey != null) used.add(String(s.dayKey)); }); });
  for (let c = 65; c <= 90; c++) { const l = String.fromCharCode(c); if (!used.has(l)) return l; }
  let k = "D" + Date.now(); while (used.has(k)) k += "x";
  return k;
}

const EDIT_ACTIONS = ["modifica", "aggiungi", "rimuovi", "sposta", "sostituisci", "aggiungi_giornata", "modifica_giornata", "rimuovi_giornata"];
const FIELDS = ["nome", "muscolo", "secondario", "tipo", "serie", "riscaldamenti", "ripetizioni", "kg", "recupero", "per_lato", "sezione", "superset"];
const PHASE_IN = { riscaldamento: "warm", allenamento: "main", stretching: "cool" };
const TYPE_IN = { ripetizioni: "reps", tempo: "time", distanza: "dist", reps: "reps", time: "time", dist: "dist" };
const TYPE_WORD = { reps: "ripetizioni", time: "tempo", dist: "distanza" };
const MUSCLE_ALIAS = { pettorali: "Petto", pettorale: "Petto", dorso: "Schiena", dorsali: "Schiena", dorsale: "Schiena", spalla: "Spalle", deltoidi: "Spalle",
  deltoide: "Spalle", bicipite: "Bicipiti", tricipite: "Tricipiti", addome: "Addominali", addominale: "Addominali", core: "Addominali",
  quadricipite: "Quadricipiti", femorali: "Femorale", ischiocrurali: "Femorale", gluteo: "Glutei", polpaccio: "Polpacci" };
const NO_MUSCLE = ["nessuno", "nessuna", "niente", "-", "—"];
function muscleIn(v, optional, bad) {
  if (optional && (v === null || v === "" || NO_MUSCLE.includes(fold(v)))) return null;
  const f = fold(v), m = MUSCLES.find((x) => fold(x) === f) || (own(MUSCLE_ALIAS, f) ? MUSCLE_ALIAS[f] : null);
  if (!m) bad(`muscolo «${v}» non valido (validi: ${MUSCLES.join(", ")}${optional ? "; oppure nessuno" : ""})`);
  return m;
}
const toNum = (v) => typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(",", ".")) : NaN;
function intIn(v, lo, hi, what, bad) {
  const n = toNum(v);
  if (!Number.isInteger(n) || n < lo || n > hi) bad(`${what}: serve un numero intero da ${lo} a ${hi} (ricevuto ${JSON.stringify(v)})`);
  return n;
}
function boolIn(v, what, bad) {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "false") return v === "true";
  return bad(`${what}: true o false`);
}
function applyValues(e, v, bad) {
  if (!v || typeof v !== "object" || Array.isArray(v)) bad("«valori» deve essere un oggetto con i campi da impostare");
  for (const k of Object.keys(v)) if (!FIELDS.includes(k)) bad(`campo «${k}» sconosciuto (campi: ${FIELDS.join(", ")})`);
  if (v.nome !== undefined) {
    const n = String(v.nome == null ? "" : v.nome).replace(/\s+/g, " ").trim();
    if (!n) bad("il nome non può essere vuoto");
    if (n.length > 120) bad("nome troppo lungo (al massimo 120 caratteri)");
    e.name = n;
  }
  if (v.muscolo !== undefined) e.muscle = muscleIn(v.muscolo, false, bad);
  if (v.secondario !== undefined) e.secondary = muscleIn(v.secondario, true, bad);
  if (v.tipo !== undefined) { const t = own(TYPE_IN, fold(v.tipo)) ? TYPE_IN[fold(v.tipo)] : null; if (!t) bad(`tipo «${v.tipo}» non valido (ripetizioni, tempo o distanza)`); e.type = t; }
  if (v.serie !== undefined) e.sets = intIn(v.serie, 0, 30, "serie", bad);
  if (v.riscaldamenti !== undefined) e.warmups = intIn(v.riscaldamenti, 0, 5, "riscaldamenti", bad);
  if (v.ripetizioni !== undefined) {
    const r = String(v.ripetizioni == null ? "" : v.ripetizioni).replace(/\s+/g, " ").trim();
    if (r.length > 30) bad("ripetizioni: testo troppo lungo (es. \"8-12\", \"10\", \"45\")");
    e.reps = r;
  }
  if (v.kg !== undefined) { const n = toNum(v.kg); if (!Number.isFinite(n) || n < 0 || n > 1000) bad(`kg: serve un numero da 0 a 1000 (ricevuto ${JSON.stringify(v.kg)})`); e.kg = Math.round(n * 100) / 100; }
  if (v.recupero !== undefined) e.rest = intIn(v.recupero, 0, 3600, "recupero (secondi)", bad);
  if (v.per_lato !== undefined) e.perSide = boolIn(v.per_lato, "per_lato", bad);
  if (v.sezione !== undefined) { const p = own(PHASE_IN, fold(v.sezione)) ? PHASE_IN[fold(v.sezione)] : null; if (!p) bad(`sezione «${v.sezione}» non valida (riscaldamento, allenamento o stretching)`); e.phase = p; }
  if (v.superset !== undefined) e.linkNext = boolIn(v.superset, "superset", bad);
  if (!(num(e.sets) > 0) && !(num(e.warmups) > 0)) bad("serie 0 solo con almeno 1 riscaldamento (esercizio di solo riscaldamento)");
}
function findDay(days, q, bad, what = "giornata") {
  const s = String(q == null ? "" : q).trim(), keys = Object.keys(days);
  if (!s) bad(`manca «${what}»`);
  if (own(days, s)) return s;
  const ci = keys.filter((k) => k.toLowerCase() === s.toLowerCase());
  if (ci.length === 1) return ci[0];
  const f = fold(s), list = keys.map((k) => `${k} «${days[k].name}»`).join(", ");
  for (const test of [(n) => n === f, (n) => n.startsWith(f), (n) => n.includes(f)]) {
    const hit = keys.filter((k) => test(fold(days[k].name)));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) bad(`più giornate corrispondono a «${s}»: ${hit.map((k) => `${k} «${days[k].name}»`).join(", ")}; usa la lettera`);
  }
  return bad(`nessuna giornata «${s}» (giornate: ${list})`);
}
function findEx(d, q, bad, what = "esercizio") {
  const s = String(q == null ? "" : q).trim(), list = d.exercises;
  if (!s) bad(`manca «${what}»`);
  const pos = /^#\s*(\d+)$/.exec(s);
  if (pos) { const i = +pos[1] - 1; if (i < 0 || i >= list.length) bad(`${what} ${s}: «${d.name}» ha ${list.length} esercizi`); return i; }
  const byId = list.map((e, i) => i).filter((i) => list[i].id === s);
  if (byId.length === 1) return byId[0];
  const f = fold(s);
  for (const test of [(n) => n === f, (n) => n.startsWith(f), (n) => n.includes(f)]) {
    const hit = list.map((e, i) => i).filter((i) => test(fold(list[i].name)));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) bad(`più esercizi di «${d.name}» corrispondono a «${s}»: ${hit.map((i) => `#${i + 1} «${list[i].name}»`).join(", ")}; usa il nome intero o #posizione`);
  }
  return bad(`nessun esercizio «${s}» in «${d.name}» (esercizi: ${list.map((e, i) => `#${i + 1} ${e.name}`).join(", ") || "nessuno"})`);
}
/* dove inserire: dopo un esercizio (in fondo al suo superset, senza spezzarlo), in una posizione o in fondo alla sezione */
function insertIndex(d, o, bad) {
  const list = d.exercises;
  if (o.dopo != null && o.posizione != null) bad("usa «dopo» oppure «posizione», non tutti e due");
  if (o.dopo != null) { let i = findEx(d, o.dopo, bad, "dopo"); while (i < list.length - 1 && list[i].linkNext) i++; return i + 1; }
  if (o.posizione != null) {
    let p = Math.min(intIn(o.posizione, 1, 1000, "posizione", bad) - 1, list.length);
    while (p > 0 && p < list.length && list[p - 1].linkNext) p++;
    return p;
  }
  return list.length;
}
function cleanDayName(v, bad) {
  const n = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!n) bad("manca «nome» della giornata");
  if (n.length > 80) bad("nome della giornata troppo lungo (al massimo 80 caratteri)");
  return n;
}
function exBrief(e) {
  const bits = [planLabel(e)];
  if (num(e.kg) > 0) bits.push(fn(e.kg) + " kg");
  if (e.linkNext) bits.push("superset col successivo"); else if (num(e.rest) > 0) bits.push("recupero " + Math.round(num(e.rest)) + " s");
  if (sideOf(e) && !SIDE_RX.test(String(e.name))) bits.push("per lato");
  const p = phaseOf(e), m = e.muscle !== "Altro" ? e.muscle + (secOf(e) ? " + " + e.secondary : "") : "";
  return (p !== "main" ? PHASE_LBL[p].toLowerCase() + " · " : "") + bits.join(" · ") + (m ? " — " + m : "");
}
function exDiff(a, b) {
  const out = [], ch = (lbl, x, y) => { if (x !== y) out.push(`${lbl} ${x} → ${y}`); };
  if (a.name !== b.name) out.push(`nome «${a.name}» → «${b.name}»`);
  ch("muscolo", a.muscle, b.muscle);
  ch("secondario", a.secondary || "nessuno", b.secondary || "nessuno");
  ch("tipo", TYPE_WORD[a.type], TYPE_WORD[b.type]);
  ch("riscaldamenti", String(a.warmups || 0), String(b.warmups || 0));
  ch("serie", String(a.sets), String(b.sets));
  ch("ripetizioni", a.reps || "—", b.reps || "—");
  ch("kg", fn(a.kg), fn(b.kg));
  ch("recupero", Math.round(num(a.rest)) + " s", Math.round(num(b.rest)) + " s");
  if (sideOf(a) !== sideOf(b)) out.push(sideOf(b) ? "ora per lato" : "non più per lato");
  if (phaseOf(a) !== phaseOf(b)) out.push(`sezione ${PHASE_LBL[phaseOf(a)]} → ${PHASE_LBL[phaseOf(b)]}`);
  if (!!a.linkNext !== !!b.linkNext) out.push(b.linkNext ? "ora in superset col successivo" : "non più in superset col successivo");
  return out;
}
/* applica le modifiche in ordine a una copia della scheda: alla prima non valida si ferma tutto (niente salvato) */
function editPlan(data, args) {
  const days = sanitizeDays(data && data.days);
  if (!Object.keys(days).length) throw new Error("Nessuna scheda sincronizzata: apri l'app Palestra con la sincronizzazione attiva.");
  const why = String(args.motivo == null ? "" : args.motivo).replace(/\s+/g, " ").trim();
  if (!why) throw new Error("Scrivi in «motivo» perché cambi la scheda: l'utente lo legge nell'app.");
  if (why.length > 300) throw new Error("«motivo» troppo lungo: al massimo 300 caratteri.");
  const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (e) { return v; } };   // client che mandano gli oggetti come testo JSON
  const ops = parse(args.modifiche);
  if (!Array.isArray(ops) || !ops.length) throw new Error("«modifiche» deve essere un elenco con almeno una modifica.");
  if (ops.length > 60) throw new Error("Al massimo 60 modifiche per volta.");
  const sessions = readSessions(data), lines = [], touched = new Set();
  ops.forEach((o0, n) => {
    const o = parse(o0);
    const bad = (m) => { throw new Error(`Modifica ${n + 1}${o && typeof o.azione === "string" ? " (" + o.azione + ")" : ""}: ${m}.`); };
    if (!o || typeof o !== "object" || Array.isArray(o)) bad("deve essere un oggetto");
    if (typeof o.valori === "string") o.valori = parse(o.valori);
    if (!EDIT_ACTIONS.includes(o.azione)) bad(`«azione» deve essere una di: ${EDIT_ACTIONS.join(", ")}`);
    const at = (d, e) => String(d.exercises.indexOf(e) + 1);
    switch (o.azione) {
      case "modifica": {
        const k = findDay(days, o.giornata, bad), d = days[k], e = d.exercises[findEx(d, o.esercizio, bad)], before = { ...e };
        if (o.valori === undefined) bad("servono i «valori» da cambiare");
        applyValues(e, o.valori, bad);
        if (e.name !== before.name) renameId(days, e);
        cleanPlanEx(e); normalizeLinks(d);
        const df = exDiff(before, e);
        lines.push(`${dayShort(d.name)}: «${before.name}» ${df.length ? df.join(", ") : "senza cambiamenti"}`);
        touched.add(k); break;
      }
      case "aggiungi": {
        const k = findDay(days, o.giornata, bad), d = days[k], v = o.valori;
        if (!v || typeof v !== "object" || v.nome == null || !String(v.nome).trim()) bad("serve «valori.nome»");
        if (v.muscolo === undefined) bad("serve «valori.muscolo» (Altro per riscaldamenti, mobilità e stretching)");
        if (d.exercises.length >= 100) bad(`«${d.name}» ha già 100 esercizi`);
        const e = { id: "", name: "", muscle: "Altro", secondary: null, type: "reps", sets: 3, reps: "8-10", kg: 0, rest: 90, linkNext: false };
        applyValues(e, v, bad);
        if (v.tipo === undefined) e.type = guessType(e.reps);
        e.id = idForName(days, sessions, e.name);
        d.exercises.splice(insertIndex(d, o, bad), 0, e);
        cleanPlanEx(e); normalizeLinks(d);
        lines.push(`${dayShort(d.name)}: aggiunto «${e.name}» (${exBrief(e)}) in posizione ${at(d, e)}`);
        touched.add(k); break;
      }
      case "rimuovi": {
        const k = findDay(days, o.giornata, bad), d = days[k], i = findEx(d, o.esercizio, bad), e = d.exercises[i];
        d.exercises.splice(i, 1);
        // tolto l'ultimo di un superset: il precedente non si lega all'esercizio dopo
        if (!e.linkNext && i > 0 && d.exercises[i - 1]) d.exercises[i - 1].linkNext = false;
        normalizeLinks(d);
        lines.push(`${dayShort(d.name)}: tolto «${e.name}»`);
        touched.add(k); break;
      }
      case "sposta": {
        const k = findDay(days, o.giornata, bad), d = days[k], i = findEx(d, o.esercizio, bad), e = d.exercises[i], ph0 = phaseOf(e);
        const k2 = o.verso_giornata != null && String(o.verso_giornata).trim() !== "" ? findDay(days, o.verso_giornata, bad, "verso_giornata") : k, d2 = days[k2];
        if (k2 === k && o.dopo == null && o.posizione == null) bad("indica «posizione», «dopo» o «verso_giornata»");
        if (k2 !== k && d2.exercises.length >= 100) bad(`«${d2.name}» ha già 100 esercizi`);
        // come il trascinamento nell'app: i superset attorno all'esercizio spostato si sciolgono
        if (i > 0) d.exercises[i - 1].linkNext = false;
        d.exercises.splice(i, 1); e.linkNext = false;
        const t = insertIndex(d2, o, bad);
        d2.exercises.splice(t, 0, e);
        // portato in un'altra sezione: prende quella dei vicini
        { const pv = d2.exercises[t - 1], nx = d2.exercises[t + 1], pp = pv ? phaseOf(pv) : null, np = nx ? phaseOf(nx) : null, mp = phaseOf(e);
          if (mp !== pp && mp !== np) e.phase = pp || np || mp; }
        if (t > 0) d2.exercises[t - 1].linkNext = false;
        normalizeLinks(d); if (d2 !== d) normalizeLinks(d2);
        const sec = phaseOf(e) !== ph0 ? `, ora in ${PHASE_LBL[phaseOf(e)]}` : "";
        lines.push(k2 === k ? `${dayShort(d.name)}: «${e.name}» spostato in posizione ${at(d, e)}${sec}` : `«${e.name}» spostato da ${dayShort(d.name)} a ${dayShort(d2.name)} (posizione ${at(d2, e)}${sec})`);
        touched.add(k); touched.add(k2); break;
      }
      case "sostituisci": {
        const k = findDay(days, o.giornata, bad), d = days[k], i = findEx(d, o.esercizio, bad), old = d.exercises[i], v = o.valori;
        if (!v || typeof v !== "object" || v.nome == null || !String(v.nome).trim()) bad("serve «valori.nome» (il nuovo esercizio)");
        // stessa posizione, serie, ripetizioni, recupero, sezione e superset; il carico si riparte da capo
        const e = { ...old, kg: 0 }; delete e.perSide;
        applyValues(e, v, bad);
        if (normName(e.name) === normName(old.name)) bad("è lo stesso esercizio: per cambiarne i valori usa «modifica»");
        e.id = idForName(days, sessions, e.name);
        d.exercises[i] = e; cleanPlanEx(e); normalizeLinks(d);
        lines.push(`${dayShort(d.name)}: «${old.name}» sostituito da «${e.name}» (${exBrief(e)})`);
        touched.add(k); break;
      }
      case "aggiungi_giornata": {
        if (Object.keys(days).length >= 30) bad("al massimo 30 giornate");
        const name = cleanDayName(o.nome, bad), spare = o.riserva === undefined ? false : boolIn(o.riserva, "riserva", bad), k = nextDayKey(days, data);
        days[k] = { name, ...(spare ? { spare: true } : {}), exercises: [] };
        lines.push(`aggiunta la giornata «${name}»${spare ? " (riserva)" : ""}`);
        touched.add(k); break;
      }
      case "modifica_giornata": {
        const k = findDay(days, o.giornata, bad), d = days[k], was = { name: d.name, spare: !!d.spare };
        if (o.nome === undefined && o.riserva === undefined) bad("indica «nome» o «riserva»");
        if (o.nome !== undefined) d.name = cleanDayName(o.nome, bad);
        if (o.riserva !== undefined) { if (boolIn(o.riserva, "riserva", bad)) d.spare = true; else delete d.spare; }
        const ch = [];
        if (d.name !== was.name) ch.push(`rinominata «${d.name}»`);
        if (!!d.spare !== was.spare) ch.push(d.spare ? "ora è una riserva" : "ora è una giornata normale");
        lines.push(`giornata «${was.name}» ${ch.length ? ch.join(", ") : "senza cambiamenti"}`);
        touched.add(k); break;
      }
      case "rimuovi_giornata": {
        const k = findDay(days, o.giornata, bad), d = days[k];
        if (Object.keys(days).length <= 1) bad("deve restare almeno una giornata");
        if (!d.spare && Object.values(days).filter((x) => !x.spare).length <= 1) bad("serve almeno una giornata normale (non di riserva)");
        delete days[k]; touched.delete(k);
        lines.push(`tolta la giornata «${d.name}» (gli allenamenti fatti restano nello storico)`);
        break;
      }
    }
  });
  // restassero solo riserve, non ci sarebbe più una giornata "che tocca" a cui farle valere
  if (!Object.values(days).some((d) => !d.spare)) throw new Error("Nessuna modifica salvata: deve restare almeno una giornata normale (non di riserva).");
  const out = sanitizeDays(days);
  return { days: out, why, lines, touched: [...touched].filter((k) => own(out, k)) };
}
const NO_WRITE = "Claude non ha il permesso di modificare la scheda. Nell'app Palestra l'utente deve accendere «Claude può modificare la scheda» (Impostazioni → Claude legge i tuoi allenamenti); poi riprova. Le letture funzionano comunque.";
/* scrive la scheda nuova accanto a storico e impostazioni, condizionata all'etag (come l'app: niente sovrascritto al buio).
   Il segno "claude" dice all'app che la scheda l'ha cambiata Claude: lei lo mostra con Annulla */
async function saveDays(ctx, build) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const f = await ctx.store.getWithMetadata("u-" + ctx.code, { type: "json" });
    if (!f || !f.data || typeof f.data !== "object") throw new Error("Nessun dato sincronizzato: apri l'app Palestra con la sincronizzazione attiva.");
    const cur = f.data, res = build(cur), now = Date.now(), hash = daysHash(res.days);
    const out = { ...cur, rev: (Number(cur.rev) || 0) + 1, at: now, days: res.days, daysAt: now,
      wid: "claude-" + newId().slice(1, 11),
      claude: { at: now, hash, why: res.why.slice(0, 300), lines: res.lines.slice(0, 60).map((x) => String(x).slice(0, 300)), ...(res.undo ? { undo: true } : {}) } };
    if (JSON.stringify(out).length > 5 * 1024 * 1024) throw new Error("Dati troppo grandi per la sincronizzazione (oltre 5 MB): nessuna modifica salvata.");
    const w = await ctx.store.setJSON("u-" + ctx.code, out, f.etag ? { onlyIfMatch: f.etag } : {});
    if (w && w.modified === false) continue;   // l'app ha appena sincronizzato: si rilegge e si rifà
    ctx.saved(out);
    return { cur, out, res, hash };
  }
  throw new Error("L'app sta sincronizzando proprio adesso: nessuna modifica salvata, riprova fra qualche secondo.");
}
const AFTER_SAVE = "Arrivano sul telefono alla prossima sincronizzazione (quando l'utente apre l'app): lì vede cosa è cambiato e può tornare indietro con «Rimetti com'era». Puoi annullare anche tu con annulla_modifica.";
async function toolEdit(ctx, args) {
  const { cur, out, res, hash } = await saveDays(ctx, (cur) => editPlan(cur, args));
  // per annulla_modifica: la scheda di prima e l'impronta di quella scritta (se poi cambia, non si annulla al buio)
  let undoNote = "";
  try { await ctx.store.setJSON("k-" + ctx.code, { at: out.at, why: res.why, before: sanitizeDays(cur.days), after: hash }); }
  catch (e) { undoNote = "\n(annulla_modifica non disponibile per questa modifica: l'utente può annullare dall'app.)"; }
  const L = [`# Scheda modificata: ${many(res.lines.length, "modifica salvata", "modifiche salvate")}`, `Motivo: ${res.why}`, ""];
  res.lines.forEach((x) => L.push("- " + x));
  L.push("", AFTER_SAVE + undoNote);
  const days = planDays(out).filter((d) => res.touched.includes(d.key));
  if (days.length) { L.push("", "## Come sono adesso le giornate cambiate"); days.forEach((d) => dayBlock(d, L, null)); }
  return L.join("\n");
}
async function toolUndo(ctx) {
  const u = await ctx.store.get("k-" + ctx.code, { type: "json" });
  if (!u || !u.before || typeof u.after !== "string") return "Niente da annullare: nessuna modifica di Claude alla scheda salvata di recente (o è già stata annullata).";
  const when = `${dmy(isoAt(num(u.at)))} alle ${hhmm(num(u.at))}`;
  await saveDays(ctx, (cur) => {
    if (daysHash(sanitizeDays(cur.days)) !== u.after) throw new Error("La scheda è cambiata dopo l'ultima modifica di Claude (dall'app o da un altro dispositivo): non la rimetto com'era per non perdere quei cambiamenti. Fai le modifiche inverse con modifica_scheda, oppure l'utente può usare «Rimetti com'era» nell'app.");
    const before = sanitizeDays(u.before);
    if (!Object.keys(before).length) throw new Error("Scheda di prima non leggibile: niente annullato.");
    return { days: before, why: "Annullata la modifica di Claude del " + when + ": " + String(u.why || ""), lines: [`scheda rimessa com'era prima della modifica del ${when}`], undo: true };
  });
  try { await ctx.store.delete("k-" + ctx.code); } catch (e) { /* resta: un secondo annulla trova la scheda cambiata e si ferma */ }
  return `Fatto: la scheda è tornata com'era prima della modifica del ${when} («${String(u.why || "")}»). Arriva sul telefono alla prossima sincronizzazione (quando l'utente apre l'app).`;
}

/* ---------------- strumenti ---------------- */
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS = [
  { name: "riepilogo", title: "Riepilogo degli allenamenti",
    description: "Quadro generale: cose da sapere sull'utente (obiettivi, infortuni), scheda in corso, totali, ultimi 7 e 28 giorni (allenamenti, ore, peso sollevato, serie di lavoro), settimane di fila, record recenti, esercizi fermi, ultimi allenamenti. Usalo per primo.",
    inputSchema: { type: "object", properties: {} }, annotations: { ...RO, title: "Riepilogo" }, run: toolSummary },
  { name: "scheda", title: "Scheda di allenamento",
    description: "La scheda attuale: ogni giornata (anche le riserve, versioni corte) con gli esercizi in ordine, sezione (riscaldamento, allenamento, stretching), serie, ripetizioni, kg di partenza, recupero, muscolo principale e secondario, superset/circuiti, esercizi per lato; più le serie a settimana per muscolo che la scheda prevede rispetto agli obiettivi.",
    inputSchema: { type: "object", properties: {} }, annotations: { ...RO, title: "Scheda" }, run: toolPlan },
  { name: "allenamenti", title: "Allenamenti fatti",
    description: "Allenamenti salvati con tutte le serie (kg×ripetizioni o secondi; R = riscaldamento, F = cedimento, D = drop set, A = AMRAP, @ = RPE), durata, peso sollevato e note. Dal più recente.",
    inputSchema: { type: "object", properties: {
      dal: { type: "string", description: "Data di inizio, AAAA-MM-GG (compresa)" },
      al: { type: "string", description: "Data di fine, AAAA-MM-GG (compresa)" },
      giornata: { type: "string", description: "Solo una giornata: parte del nome (es. \"Lunedì\") o la sua lettera" },
      limite: { type: "integer", minimum: 1, maximum: 60, description: "Quanti allenamenti al massimo (predefinito 10)" } } },
    annotations: { ...RO, title: "Allenamenti" }, run: toolWorkouts },
  { name: "storico_esercizio", title: "Storico di un esercizio",
    description: "Tutte le sedute di un esercizio (cerca per nome, anche parziale, senza accenti): serie, serie migliore, massimale stimato (Epley, serie da 1 a 12 ripetizioni), peso sollevato, record di sempre e se è fermo.",
    inputSchema: { type: "object", properties: {
      esercizio: { type: "string", description: "Nome o parte del nome (es. \"lat machine\", \"panca\")" },
      limite: { type: "integer", minimum: 1, maximum: 100, description: "Quante sedute al massimo, dalla più recente (predefinito 15)" } }, required: ["esercizio"] },
    annotations: { ...RO, title: "Storico esercizio" }, run: toolExercise },
  { name: "volume_muscoli", title: "Serie per muscolo a settimana",
    description: "Settimana per settimana (da lunedì a domenica, l'ultima è quella in corso): allenamenti, peso sollevato, serie di lavoro e serie per muscolo (principale 1, secondario ½, riscaldamenti e stretching esclusi) rispetto agli obiettivi; più la media delle settimane complete.",
    inputSchema: { type: "object", properties: { settimane: { type: "integer", minimum: 1, maximum: 26, description: "Quante settimane (predefinito 4)" } } },
    annotations: { ...RO, title: "Volume per muscolo" }, run: toolVolume },
  { name: "record", title: "Record personali",
    description: "Per ogni esercizio la serie migliore di sempre (carico più alto, a parità più ripetizioni; a corpo libero più ripetizioni; senza riscaldamenti e drop set), con data e massimale stimato. I più recenti in cima.",
    inputSchema: { type: "object", properties: {
      esercizio: { type: "string", description: "Solo gli esercizi il cui nome contiene questo testo" },
      limite: { type: "integer", minimum: 1, maximum: 200, description: "Quanti esercizi al massimo (predefinito 40)" } } },
    annotations: { ...RO, title: "Record" }, run: toolRecords },
  { name: "modifica_scheda", title: "Modifica la scheda", write: true,
    description: "Modifica la SCHEDA dell'utente (mai lo storico degli allenamenti): valori di un esercizio (serie, ripetizioni, kg, recupero, riscaldamenti, muscoli, tipo, per lato, sezione, superset), aggiungere, togliere, spostare o sostituire esercizi, aggiungere, rinominare o togliere giornate. "
      + "Tutte le modifiche in UNA chiamata: si applicano in ordine e si salvano insieme; se una non è valida non si salva niente e la risposta dice quale. "
      + "Prima leggi «scheda», proponi le modifiche all'utente e falle solo se è d'accordo. Per cambiare esercizio usa «sostituisci» (storico separato); «nome» in «modifica» solo per correggere o precisare lo stesso esercizio (lo storico resta unito). "
      + "L'utente vede le modifiche nell'app alla prossima sincronizzazione e può annullarle. Funziona solo se nell'app è acceso «Claude può modificare la scheda».",
    inputSchema: { type: "object", properties: {
      motivo: { type: "string", maxLength: 300, description: "Perché cambi la scheda, in una frase: l'utente lo legge nell'app (es. \"Più volume per la schiena; panca ferma da 3 sedute\")." },
      modifiche: { type: "array", minItems: 1, maxItems: 60, description: "Le modifiche, in ordine.", items: { type: "object", properties: {
        azione: { type: "string", enum: EDIT_ACTIONS, description: "modifica: cambia i «valori» di un esercizio · aggiungi: nuovo esercizio («valori» con nome e muscolo) · rimuovi · sposta: «posizione», «dopo» e/o «verso_giornata» · sostituisci: un altro esercizio al suo posto («valori» con il nome nuovo; tiene serie, ripetizioni, recupero, sezione e superset, kg da zero se non li dai) · aggiungi_giornata: «nome» (e «riserva») · modifica_giornata: «nome» e/o «riserva» · rimuovi_giornata" },
        giornata: { type: "string", description: "La giornata: lettera (es. \"A\", vedi «scheda») o nome, anche parziale (es. \"Lunedì\"). Non per aggiungi_giornata." },
        esercizio: { type: "string", description: "L'esercizio nella giornata: nome, anche parziale, o #posizione (#1 = il primo, come in «scheda», contando le modifiche precedenti di questa chiamata)." },
        valori: { type: "object", additionalProperties: false, description: "Solo i campi da impostare.", properties: {
          nome: { type: "string" },
          muscolo: { type: "string", enum: MUSCLES, description: "Muscolo principale; Altro per riscaldamenti, mobilità e stretching (non contano nelle serie per muscolo)." },
          secondario: { type: "string", enum: [...MUSCLES.filter((m) => m !== "Altro"), "nessuno"], description: "Muscolo secondario (conta ½ serie) o nessuno." },
          tipo: { type: "string", enum: ["ripetizioni", "tempo", "distanza"] },
          serie: { type: "integer", minimum: 0, maximum: 30, description: "Serie di lavoro (0 solo per esercizi di solo riscaldamento)." },
          riscaldamenti: { type: "integer", minimum: 0, maximum: 5, description: "Serie di avvicinamento create da sole prima di quelle di lavoro." },
          ripetizioni: { type: "string", description: "Obiettivo come testo: \"8-12\", \"10\"; per tipo tempo i secondi (\"45\"), per distanza i metri." },
          kg: { type: "number", minimum: 0, maximum: 1000, description: "Carico di partenza (0 = a corpo libero o da trovare)." },
          recupero: { type: "integer", minimum: 0, maximum: 3600, description: "Recupero dopo ogni serie, in secondi." },
          per_lato: { type: "boolean", description: "Ripetizioni di ogni lato (un braccio o una gamba alla volta): il peso sollevato conta i due lati." },
          sezione: { type: "string", enum: ["riscaldamento", "allenamento", "stretching"], description: "Predefinita: allenamento." },
          superset: { type: "boolean", description: "In superset/circuito col successivo (senza recupero fra i due)." } } },
        posizione: { type: "integer", minimum: 1, description: "Dove metterlo (1 = primo; per sposta contata senza l'esercizio spostato); mai in mezzo a un superset. Un esercizio spostato fra esercizi di un'altra sezione ne prende la sezione, come trascinandolo nell'app. Senza posizione né dopo: in fondo alla sua sezione." },
        dopo: { type: "string", description: "Mettilo dopo questo esercizio (nome o #posizione; dopo tutto il superset se ne fa parte)." },
        verso_giornata: { type: "string", description: "sposta: la giornata di arrivo (lettera o nome)." },
        nome: { type: "string", description: "aggiungi_giornata e modifica_giornata: il nome della giornata (es. \"Giovedì · Palestra · Gambe\")." },
        riserva: { type: "boolean", description: "Giornata di riserva: versione corta per i giorni con poco tempo, vale come la giornata che tocca." } },
        required: ["azione"] } } },
      required: ["motivo", "modifiche"] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: "Modifica scheda" }, run: toolEdit },
  { name: "annulla_modifica", title: "Annulla l'ultima modifica alla scheda", write: true,
    description: "Rimette la scheda com'era prima dell'ultima modifica_scheda. Non annulla se nel frattempo la scheda è cambiata dall'app (lì l'utente ha «Rimetti com'era»). Serve il permesso «Claude può modificare la scheda».",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: "Annulla modifica" }, run: toolUndo },
];

function header(data) {
  const at = num(data && data.at);
  return at ? `(dati sincronizzati il ${dmy(isoAt(at))} alle ${hhmm(at)}: quello che l'app ha salvato fino all'ultima sincronizzazione)` : "";
}
const many = (n, one, more) => n + " " + (n === 1 ? one : more);
function sessLine(s, names) {
  const min = sessMin(s), alt = s.forDay ? (names && own(names, s.forDay) ? ` (riserva al posto di ${names[s.forDay].split("·")[0].trim()})` : " (riserva)") : "";
  return `${dm(s.iso)} ${WD[utc(s.iso).getUTCDay()].slice(0, 3)} · ${s.dayName}${alt}${min ? " · " + fmtMin(min) : ""} · ${workSets(s)} serie di lavoro${sessTon(s) > 0 ? " · " + fmtTon(sessTon(s)) : ""}`;
}
function entryLine(e) {
  const sets = e.detail.map((d) => (d.w ? "R " : "") + (d.t ? KINDS[d.t] + " " : "") + setTxt(d, e.type) + (d.rpe ? " @" + fn(d.rpe) : "")).join(", ");
  const m = e.muscle === "Altro" ? "" : " [" + e.muscle + (secOf(e) ? " + " + secOf(e) : "") + "]";
  return `- ${e.name}${e.side && !SIDE_RX.test(e.name) ? " (per lato)" : ""}${m}: ${sets}`;
}

function toolSummary(data) {
  const S = readSessions(data), today = todayIso(), L = [];
  L.push("# Palestra · riepilogo", header(data));
  const ctx = data && data.settings && typeof data.settings.aiContext === "string" ? data.settings.aiContext.trim() : "";
  if (ctx) L.push("", "Da sapere su di me: " + ctx);
  const days = planDays(data);
  const starts = (data && data.settings && Array.isArray(data.settings.planStarts) ? data.settings.planStarts : []).filter((x) => validIso(x) && x <= today).sort();
  const first = S.length ? S[0].iso : today, from = [first, ...starts.filter((x) => x > first)].pop();
  L.push("", `## Scheda`, `In corso dal ${dmy(from)} (${Math.floor(daysBetween(from, today) / 7) + 1}ª settimana). Giornate: ${days.filter((d) => !d.spare).map((d) => d.name).join(" | ") || "nessuna"}${days.some((d) => d.spare) ? ". Riserve (versioni corte): " + days.filter((d) => d.spare).map((d) => d.name).join(" | ") : ""}.`);
  if (!S.length) { L.push("", "Nessun allenamento salvato."); return L.join("\n"); }
  const w7 = stats(S, addDays(today, -6), today), w28 = stats(S, addDays(today, -27), today);
  const line = (t, r) => `${t}: ${many(r.n, "allenamento", "allenamenti")}, ${fmtMin(r.min)} in palestra, ${fmtTon(r.ton)} sollevate, ${r.sets} serie di lavoro`;
  L.push("", "## Numeri", `Totale: ${S.length} allenamenti (primo ${dmy(S[0].iso)}, ultimo ${dmy(S[S.length - 1].iso)}).`,
    line("Ultimi 7 giorni", w7), line("Ultimi 28 giorni", w28), `Settimane di fila con almeno un allenamento: ${streak(S, today)}.`);
  const rec = records(S, addDays(today, -27), today);
  L.push("", `## Record battuti negli ultimi 28 giorni: ${rec.length}`);
  rec.slice(0, 12).forEach((r) => L.push(`- ${r.name}: ${r.txt} (${r.gain}, ${dm(r.iso)})`));
  const st = byExercise(S).filter((v) => v.muscle !== "Altro").map((v) => ({ v, s: stallOf(v.items, today) })).filter((x) => x.s);
  L.push("", `## Esercizi fermi (nessun progresso nelle ultime 3 sedute): ${st.length}`);
  st.forEach(({ v, s }) => L.push(`- ${v.name} (fermo dal ${dm(s.since)}, ultima volta ${dm(s.lastIso)})`));
  L.push("", "## Ultimi allenamenti");
  const names = Object.fromEntries(days.map((d) => [d.key, d.name]));
  S.slice(-5).reverse().forEach((s) => L.push("- " + sessLine(s, names)));
  L.push("", "Per i dettagli: allenamenti, storico_esercizio, volume_muscoli, record, scheda.");
  return L.join("\n");
}
/* una giornata della scheda come testo; vol (facoltativo) accumula le serie a settimana per muscolo */
function dayBlock(d, L, vol) {
  L.push("", `## ${d.name} [giornata ${d.key}]${d.spare ? " (riserva: versione corta per i giorni con poco tempo, vale come la giornata che tocca)" : ""}`);
  if (!d.exercises.length) L.push("(nessun esercizio)");
  let ph = null;
  d.exercises.forEach((e, i) => {
    const p = own(PHASE_LBL, e.phase) ? e.phase : "main";
    if (p !== ph) { L.push(`### ${PHASE_LBL[p]}`); ph = p; }
    const prevLinked = i > 0 && d.exercises[i - 1].linkNext, muscle = MUSCLES.includes(e.muscle) ? e.muscle : "Altro";
    const bits = [planLabel(e)];
    if (sideOf(e) && !SIDE_RX.test(String(e.name || ""))) bits.push("per lato");
    if (num(e.kg) > 0) bits.push(fn(e.kg) + " kg");
    if (!e.linkNext && num(e.rest) > 0) bits.push("recupero " + Math.round(num(e.rest)) + " s");
    if (e.linkNext) bits.push("in superset/circuito col successivo, senza recupero");
    L.push(`${i + 1}. ${prevLinked ? "↳ " : ""}${String(e.name || "Esercizio")}: ${bits.join(" · ")}${muscle !== "Altro" ? " — " + muscle + (secOf({ muscle, secondary: e.secondary }) ? " + " + e.secondary : "") : ""}`);
    if (vol && !d.spare && muscle !== "Altro") { const n = Math.max(0, Math.round(num(e.sets))); vol[muscle] += n; const sm = secOf({ muscle, secondary: e.secondary }); if (sm) vol[sm] += n * 0.5; }
  });
}
function toolPlan(data) {
  const days = planDays(data), L = ["# Scheda", header(data)];
  if (!days.length) return "Nessuna scheda sincronizzata.";
  // l'ultima modifica fatta da Claude (anche in un'altra chat): quando, perché e se la scheda è ancora quella
  const cm = data.claude;
  if (cm && typeof cm === "object" && typeof cm.why === "string" && num(cm.at) > 0)
    L.push(`Ultima modifica di Claude: ${dmy(isoAt(num(cm.at)))} alle ${hhmm(num(cm.at))}, «${cm.why}»${cm.hash === daysHash(sanitizeDays(data.days)) ? "" : " (dopo la scheda è cambiata ancora, dall'app)"}.`);
  const vol = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const d of days) dayBlock(d, L, vol);
  L.push("", "## Serie a settimana previste dalla scheda (una seduta per giornata, riserve escluse; secondario ½)");
  L.push(Object.keys(TARGET).map((m) => `${m} ${fn(vol[m])} (obiettivo ${TARGET[m][0]}-${TARGET[m][1]})`).join(" · "));
  return L.join("\n");
}
function toolWorkouts(data, a) {
  const S = readSessions(data), lim = clamp(a.limite, 1, 60, 10);
  const from = validIso(a.dal) ? a.dal : "0000-00-00", to = validIso(a.al) ? a.al : "9999-12-31";
  const g = a.giornata ? fold(a.giornata) : "";
  const list = S.filter((s) => s.iso >= from && s.iso <= to && (!g || fold(s.dayName).includes(g) || fold(s.dayKey) === g)).reverse();
  const L = [`# Allenamenti${a.dal || a.al ? " dal " + (validIso(a.dal) ? dmy(a.dal) : "inizio") + " al " + (validIso(a.al) ? dmy(a.al) : "oggi") : ""}: ${list.length}${list.length > lim ? " (mostrati i " + lim + " più recenti)" : ""}`, header(data)];
  const names = Object.fromEntries(planDays(data).map((d) => [d.key, d.name]));
  for (const s of list.slice(0, lim)) {
    L.push("", "## " + sessLine(s, names) + (s.startedAt ? ` · inizio ${hhmm(s.startedAt)}` : ""));
    s.entries.forEach((e) => L.push(entryLine(e)));
    if (s.note.trim()) L.push("Nota: " + s.note.trim());
  }
  if (!list.length) L.push("", "Nessun allenamento in questo periodo.");
  return L.join("\n");
}
function toolExercise(data, a) {
  const q = fold(a.esercizio), lim = clamp(a.limite, 1, 100, 15);
  if (!q) throw new Error("Scrivi il nome dell'esercizio (anche solo una parte).");
  const words = q.split(" "), all = byExercise(readSessions(data));
  const score = (v) => { const n = fold(v.name); return n === q ? 4 : n.startsWith(q) ? 3 : n.includes(q) ? 2 : words.every((w) => n.includes(w)) ? 1 : 0; };
  const found = all.map((v) => ({ v, sc: score(v) })).filter((x) => x.sc > 0)
    .sort((x, y) => y.sc - x.sc || y.v.items[y.v.items.length - 1].iso.localeCompare(x.v.items[x.v.items.length - 1].iso));
  if (!found.length) return `Nessun esercizio salvato che corrisponda a "${a.esercizio}". Esercizi con storico: ${all.slice(0, 60).map((v) => v.name).join(", ")}.`;
  const v = found[0].v, today = todayIso(), b = bestSet(v), st = stallOf(v.items, today);
  const best1 = Math.max(0, ...v.items.map(({ e }) => e1rm(e.detail, e.type)));
  const L = [`# ${v.name} — ${v.muscle}${v.items.length ? " · " + v.items.length + " sedute" : ""}`, header(data)];
  if (b) L.push(`Record: ${setTxt(b, v.type)} (${dmy(b.iso)})${best1 ? ` · massimale stimato migliore ${fn(best1)} kg` : ""}${st ? ` · FERMO: nessun progresso dal ${dm(st.since)}` : ""}.`);
  L.push("");
  for (const { iso, e } of v.items.slice(-lim).reverse()) {
    const top = main(e.detail).reduce((x, d) => !x || d.kg > x.kg || (d.kg === x.kg && d.val > x.val) ? d : x, null), r1 = e1rm(e.detail, e.type);
    L.push(`- ${dmy(iso)}${e.side ? " (per lato)" : ""}: ${e.detail.map((d) => (d.w ? "R " : "") + (d.t ? KINDS[d.t] + " " : "") + setTxt(d, e.type) + (d.rpe ? " @" + fn(d.rpe) : "")).join(", ")}`
      + (top ? ` · migliore ${setTxt(top, e.type)}` : "") + (r1 ? ` · 1RM stimato ${fn(r1)} kg` : "") + (e.ton > 0 ? ` · ${fmtTon(e.ton)}` : ""));
  }
  if (found.length > 1) L.push("", "Altri esercizi trovati: " + found.slice(1, 9).map((x) => x.v.name).join(", ") + ".");
  return L.join("\n");
}
function toolVolume(data, a) {
  const S = readSessions(data), n = clamp(a.settimane, 1, 26, 4), today = todayIso(), mon = mondayOf(today);
  const L = [`# Serie per muscolo, ultime ${n} settimane (principale 1, secondario ½; riscaldamenti e stretching esclusi)`, header(data)];
  const full = [];
  for (let w = n - 1; w >= 0; w--) {
    const from = addDays(mon, -7 * w), to = addDays(from, 6), cur = w === 0, r = stats(S, from, cur ? today : to);
    if (!cur) full.push(r);
    L.push("", `## ${dm(from)}–${dm(to)}${cur ? " (in corso)" : ""}: ${many(r.n, "allenamento", "allenamenti")} · ${fmtTon(r.ton)} · ${r.sets} serie di lavoro`);
    L.push(Object.keys(TARGET).map((m) => { const v = Math.round(r.vol[m]), t = TARGET[m]; return `${m} ${v} (${t[0]}-${t[1]}${v < t[0] ? ", sotto" : v > t[1] ? ", oltre" : ""})`; }).join(" · "));
  }
  if (full.length) {
    L.push("", full.length === 1 ? "## Media (una sola settimana completa)" : `## Media delle ${full.length} settimane complete`);
    L.push(Object.keys(TARGET).map((m) => `${m} ${fn(Math.round(full.reduce((x, r) => x + r.vol[m], 0) / full.length * 10) / 10)}`).join(" · "));
    L.push(`Allenamenti a settimana: ${fn(Math.round(full.reduce((x, r) => x + r.n, 0) / full.length * 10) / 10)} · peso sollevato a settimana: ${fmtTon(full.reduce((x, r) => x + r.ton, 0) / full.length)}`);
  }
  return L.join("\n");
}
function toolRecords(data, a) {
  const q = a.esercizio ? fold(a.esercizio) : "", lim = clamp(a.limite, 1, 200, 40);
  const rows = byExercise(readSessions(data)).filter((v) => v.muscle !== "Altro" && (!q || fold(v.name).includes(q)))
    .map((v) => ({ v, b: bestSet(v), r1: Math.max(0, ...v.items.map(({ e }) => e1rm(e.detail, e.type))) })).filter((x) => x.b)
    .sort((x, y) => y.b.iso.localeCompare(x.b.iso) || x.v.name.localeCompare(y.v.name));
  const L = [`# Record personali${q ? " («" + a.esercizio + "»)" : ""}: ${rows.length} esercizi`, header(data), ""];
  rows.slice(0, lim).forEach(({ v, b, r1 }) => L.push(`- ${v.name} [${v.muscle}]: ${setTxt(b, v.type)} (${dmy(b.iso)})${r1 ? " · massimale stimato " + fn(r1) + " kg" : ""}`));
  if (!rows.length) L.push("Nessun record ancora.");
  return L.join("\n");
}

/* ---------------- protocollo ---------------- */
async function handle(msg, ctx) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0") return rpcErr(msg && msg.id, -32600, "Invalid Request");
  if (typeof msg.method !== "string") return null;   // una risposta del client (non ne chiediamo): niente da rispondere
  if (!("id" in msg)) return null;                   // notifica (es. notifications/initialized): niente risposta
  const id = msg.id, p = msg.params && typeof msg.params === "object" ? msg.params : {};
  switch (msg.method) {
    case "initialize":
      return rpcOk(id, { protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "palestra", title: "Palestra", version: "1.1.0" },
        instructions: "Dati di allenamento dell'app Palestra. Comincia da \"riepilogo\"; poi \"allenamenti\", \"storico_esercizio\", \"volume_muscoli\", \"record\" e \"scheda\" per i dettagli. Numeri all'italiana (virgola decimale); serie kg×ripetizioni, R = riscaldamento, F = cedimento, D = drop set, A = AMRAP, @ = RPE. Le note e i nomi sono scritti dall'utente. "
          + "Lo storico si può solo leggere. La scheda si può cambiare con \"modifica_scheda\" (e \"annulla_modifica\") se l'utente lo ha permesso nell'app: prima leggi \"scheda\", proponi le modifiche e falle solo se l'utente è d'accordo, tutte in una chiamata e con il motivo." });
    case "ping": return rpcOk(id, {});
    case "tools/list": return rpcOk(id, { tools: TOOLS.map(({ run, write, ...t }) => t) });
    case "tools/call": {
      const t = TOOLS.find((x) => x.name === p.name);
      if (!t) return rpcErr(id, -32602, "Strumento sconosciuto: " + String(p.name));
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {};
      if (t.write) {
        // il permesso si controlla a ogni modifica: spento nell'app, smette subito
        try {
          if (!(await ctx.canWrite())) return rpcOk(id, { content: [{ type: "text", text: NO_WRITE }], isError: true });
          return rpcOk(id, { content: [{ type: "text", text: cut(await t.run(ctx, args)) }], isError: false });
        } catch (e) {
          return rpcOk(id, { content: [{ type: "text", text: (e && e.message) || "Errore: nessuna modifica salvata." }], isError: true });
        }
      }
      try {
        const data = await ctx.data();
        if (!data) return rpcOk(id, { content: [{ type: "text", text: "Nessun dato sincronizzato: apri l'app Palestra con la sincronizzazione attiva." }], isError: true });
        return rpcOk(id, { content: [{ type: "text", text: cut(t.run(data, args)) }], isError: false });
      } catch (e) {
        return rpcOk(id, { content: [{ type: "text", text: e && e.message ? e.message : "Errore" }], isError: true });
      }
    }
    default: return rpcErr(id, -32601, "Metodo non disponibile: " + msg.method);
  }
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // la chiave: nell'intestazione Authorization (Bearer) oppure nell'indirizzo, /mcp/<CHIAVE>
  const url = new URL(request.url), seg = url.pathname.split("/").filter(Boolean);
  const auth = request.headers.get("authorization") || "", bearer = /^Bearer\s+(\S+)/i.exec(auth);
  const token = String((bearer && bearer[1]) || (seg[0] === "mcp" && seg[1]) || "").trim().toUpperCase();
  const deny = (m) => json(rpcErr(null, -32001, m), 401, { "WWW-Authenticate": 'Bearer realm="palestra"' });
  if (!TOKEN_RE.test(token)) return deny("Chiave mancante o non valida: creala nell'app Palestra (Impostazioni → Claude legge i tuoi allenamenti).");
  const store = getStore({ name: "palestra-sync", consistency: "strong" });
  let ref = null;
  try { ref = await store.get("r-" + token, { type: "json" }); } catch (e) { return json(rpcErr(null, -32603, "Archivio non raggiungibile"), 503); }
  if (!ref || typeof ref.code !== "string") return deny("Chiave revocata o sbagliata: copiala di nuovo dall'app Palestra.");
  if (request.method === "GET" || request.method === "DELETE") return json(rpcErr(null, -32000, "Usa POST: questo server non apre flussi SSE e non ha sessioni."), 405, { Allow: "POST, OPTIONS" });
  if (request.method !== "POST") return json(rpcErr(null, -32000, "Metodo non consentito"), 405, { Allow: "POST, OPTIONS" });
  let body;
  try { const raw = await request.text(); if (raw.length > 1e6) return json(rpcErr(null, -32600, "Richiesta troppo grande"), 413); body = JSON.parse(raw); }
  catch (e) { return json(rpcErr(null, -32700, "Parse error"), 400); }
  // i dati si leggono una volta sola, solo se uno strumento li chiede (dopo una modifica, quelli appena scritti)
  let cache, canW;
  const ctx = { store, code: ref.code,
    data: async () => { if (cache === undefined) cache = await store.get("u-" + ref.code, { type: "json" }); return cache; },
    saved: (d) => { cache = d; },
    // permesso di modificare: acceso nell'app e per questa chiave (non per una revocata o cambiata)
    canWrite: async () => { if (canW === undefined) { const m = await store.get("m-" + ref.code, { type: "json" }); canW = !!(m && m.token === token && m.write === true); } return canW; } };
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcErr(null, -32600, "Invalid Request"), 400);
    const out = (await Promise.all(body.map((m) => handle(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await handle(body, ctx);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
};
