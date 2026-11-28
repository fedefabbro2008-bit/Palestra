/* Palestra · backup su Telegram (usato da sync.mjs, op=tg, e dalla funzione programmata telegram-backup.mjs).
   Il backup è lo stesso file di "Backup completo" nell'app (type "palestra-backup"): si reimporta da
   Impostazioni → Backup e dati → Importa. Si prende dai dati sincronizzati ("u-<codice>").
   In archivio: "t-<codice>" -> { token, chatId, chatName, bot, at, freq, last:{ at, ok, error } }.
   freq = ogni quanto arriva (vedi FREQS); senza = il 1° e il 16, come prima.
   Il token del bot resta sul server: l'app non lo rilegge mai. */

const API = "https://api.telegram.org/bot";
export const TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{30,60}$/;
const TZ = "Europe/Rome";

const dmy = (ts) => new Intl.DateTimeFormat("it-IT", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ts));
const ymd = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

/* chiamata all'API di Telegram: risponde { ok, result } oppure lancia un errore leggibile (mai il token) */
export async function tg(token, method, body) {
  let r, j = null;
  try {
    r = await fetch(API + token + "/" + method, body instanceof FormData ? { method: "POST", body }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    j = await r.json();
  } catch (e) { throw new Error("Telegram non risponde: riprova più tardi"); }
  if (!j || !j.ok) {
    const d = String((j && j.description) || "errore " + (r && r.status));
    if (/unauthorized|not found/i.test(d) && method === "getMe") throw new Error("Token del bot non valido: ricopialo da @BotFather");
    if (/chat not found/i.test(d)) throw new Error("Chat non trovata: scrivi prima un messaggio al bot, oppure controlla il chat ID");
    if (/blocked by the user/i.test(d)) throw new Error("Hai bloccato il bot su Telegram: sbloccalo e riprova");
    if (/conflict/i.test(d)) throw new Error("Il bot usa già un webhook (per esempio quello di un'altra app): inserisci il chat ID a mano");
    throw new Error("Telegram: " + d.slice(0, 160));
  }
  return j.result;
}

/* la chat privata più recente che ha scritto al bot (per non chiedere il chat ID) */
export async function findChat(token) {
  const ups = await tg(token, "getUpdates", { limit: 50, allowed_updates: ["message"] });
  for (let i = ups.length - 1; i >= 0; i--) {
    const c = ups[i] && ups[i].message && ups[i].message.chat;
    if (c && c.type === "private") return { id: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "chat" };
  }
  return null;
}

/* il file di backup e la didascalia, dai dati sincronizzati */
export function buildBackup(data, now = Date.now(), code = null) {
  const logs = data && data.logs && typeof data.logs === "object" && !Array.isArray(data.logs) ? data.logs : {};
  const days = data && data.days && typeof data.days === "object" ? data.days : {};
  const isos = Object.keys(logs).filter((k) => Array.isArray(logs[k]) && logs[k].length).sort();
  const n = isos.reduce((a, k) => a + logs[k].length, 0);
  // impostazioni complete come in «Backup completo»: tutte quelle del dispositivo che ha salvato per ultimo, con sopra
  // quelle sincronizzate (tema, sfondo, testo per Claude…), che valgono per tutti i dispositivi
  const obj = (o) => o && typeof o === "object" && !Array.isArray(o) ? o : {};
  const settings = { ...obj(data && data.allSettings), ...obj(data && data.settings) };
  // come nell'app: il codice di sincronizzazione, per ricollegare tutto importando il file su un altro telefono (il token no)
  const file = { type: "palestra-backup", schemaVersion: 2, exportedAt: new Date(now).toISOString(), source: "telegram", ...(code ? { link: { sync: code } } : {}), days, logs, settings };
  const nDays = Object.keys(days).length;
  const last = isos.length ? isos[isos.length - 1] : null;
  const caption = `Backup Palestra · ${dmy(now)}\n${n === 1 ? "1 allenamento" : n + " allenamenti"}${last ? " · ultimo " + last.slice(8, 10) + "/" + last.slice(5, 7) : ""} · scheda di ${nDays === 1 ? "1 giornata" : nDays + " giornate"}`
    + `\nPer ripristinarlo: app Palestra → Impostazioni → Backup e dati → Importa questo file (ricollega anche sincronizzazione, Telegram e Claude). Contiene il codice di sincronizzazione: non inoltrarlo.`;
  return { json: JSON.stringify(file), name: `palestra-backup-${ymd(now)}.json`, caption, sessions: n };
}

/* manda il backup del codice alla chat collegata e annota l'esito */
export async function sendBackup(store, code, conf, now = Date.now()) {
  const data = await store.get("u-" + code, { type: "json" });
  if (!data) throw new Error("Nessun dato sincronizzato con questo codice");
  const b = buildBackup(data, now, code);
  const fd = new FormData();
  fd.append("chat_id", conf.chatId);
  fd.append("caption", b.caption);
  fd.append("document", new Blob([b.json], { type: "application/json" }), b.name);
  await tg(conf.token, "sendDocument", fd);
  return b;
}

/* frequenza dei backup: la funzione programmata gira ogni giorno alle 07:00 UTC e manda solo a chi tocca quel giorno */
export const FREQS = { giorno: "ogni giorno", settimana: "ogni lunedì", quindici: "il 1° e il 16 del mese", mese: "il 1° del mese" };
export const freqOf = (f) => Object.prototype.hasOwnProperty.call(FREQS, f) ? f : "quindici";
function dueOn(f, t) {
  const d = new Date(t), wd = d.getUTCDay(), md = d.getUTCDate();
  return f === "giorno" || (f === "settimana" && wd === 1) || (f === "quindici" && (md === 1 || md === 16)) || (f === "mese" && md === 1);
}
/* il giorno dell'ora data (UTC) è uno di quelli in cui va mandato il backup */
export function isDue(freq, now = Date.now()) { return dueOn(freqOf(freq), now); }

/* prossimo invio con quella frequenza, alle 07:00 UTC (come la funzione programmata) */
export function nextRun(now = Date.now(), freq) {
  const f = freqOf(freq), d = new Date(now);
  for (let i = 0; i < 70; i++) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i, 7, 0, 0);
    if (t > now && dueOn(f, t)) return t;
  }
  return null;
}
