import { getStore } from "@netlify/blobs";

/* Palestra · server MCP (Model Context Protocol) per Claude, SOLA LETTURA.
   Claude (claude.ai, app, Desktop) lo aggiunge come "connettore personalizzato" e legge da solo scheda e allenamenti
   sincronizzati: niente copia e incolla del riepilogo.

   Indirizzo:  https://<sito>/mcp/<CHIAVE>              (la chiave nell'indirizzo, "Nessun accesso")
         o:    https://<sito>/mcp  +  "Authorization: Bearer <CHIAVE>" nelle Request headers (la chiave non è nell'indirizzo)
   La chiave si crea, si cambia e si revoca dall'app (Impostazioni), cioè solo da chi ha il codice di sincronizzazione
   (vedi sync.mjs, op=mcp). È casuale e diversa dal codice: chi la conosce legge, ma non scrive e non risale al codice.

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
function toolPlan(data) {
  const days = planDays(data), L = ["# Scheda", header(data)];
  if (!days.length) return "Nessuna scheda sincronizzata.";
  const vol = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const d of days) {
    L.push("", `## ${d.name}${d.spare ? " (riserva: versione corta per i giorni con poco tempo, vale come la giornata che tocca)" : ""}`);
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
      L.push(`- ${prevLinked ? "↳ " : ""}${String(e.name || "Esercizio")}: ${bits.join(" · ")}${muscle !== "Altro" ? " — " + muscle + (secOf({ muscle, secondary: e.secondary }) ? " + " + e.secondary : "") : ""}`);
      if (!d.spare && muscle !== "Altro") { const n = Math.max(0, Math.round(num(e.sets))); vol[muscle] += n; const sm = secOf({ muscle, secondary: e.secondary }); if (sm) vol[sm] += n * 0.5; }
    });
  }
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
        serverInfo: { name: "palestra", title: "Palestra", version: "1.0.0" },
        instructions: "Dati di allenamento dell'app Palestra, in sola lettura (non si possono modificare). Comincia da \"riepilogo\"; poi \"allenamenti\", \"storico_esercizio\", \"volume_muscoli\", \"record\" e \"scheda\" per i dettagli. Numeri all'italiana (virgola decimale); serie kg×ripetizioni, R = riscaldamento, F = cedimento, D = drop set, A = AMRAP, @ = RPE. Le note e i nomi sono scritti dall'utente." });
    case "ping": return rpcOk(id, {});
    case "tools/list": return rpcOk(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const t = TOOLS.find((x) => x.name === p.name);
      if (!t) return rpcErr(id, -32602, "Strumento sconosciuto: " + String(p.name));
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {};
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
  // i dati si leggono una volta sola, solo se uno strumento li chiede
  let cache;
  const ctx = { data: async () => { if (cache === undefined) cache = await store.get("u-" + ref.code, { type: "json" }); return cache; } };
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcErr(null, -32600, "Invalid Request"), 400);
    const out = (await Promise.all(body.map((m) => handle(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await handle(body, ctx);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
};
