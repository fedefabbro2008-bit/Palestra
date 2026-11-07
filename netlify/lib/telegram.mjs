/* Palestra · backup su Telegram (usato da sync.mjs, op=tg, e dalla funzione programmata telegram-backup.mjs).
   Il backup è lo stesso file di "Backup completo" nell'app (type "palestra-backup"): si reimporta da
   Impostazioni → Backup e dati → Importa. Si prende dai dati sincronizzati ("u-<codice>").
   In archivio: "t-<codice>" -> { token, chatId, chatName, bot, at, last:{ at, ok, error } }.
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
export function buildBackup(data, now = Date.now()) {
  const logs = data && data.logs && typeof data.logs === "object" && !Array.isArray(data.logs) ? data.logs : {};
  const days = data && data.days && typeof data.days === "object" ? data.days : {};
  const isos = Object.keys(logs).filter((k) => Array.isArray(logs[k]) && logs[k].length).sort();
  const n = isos.reduce((a, k) => a + logs[k].length, 0);
  const file = { type: "palestra-backup", schemaVersion: 2, exportedAt: new Date(now).toISOString(), source: "telegram",
    days, logs, settings: data && data.settings && typeof data.settings === "object" ? data.settings : {} };
  const nDays = Object.keys(days).length;
  const last = isos.length ? isos[isos.length - 1] : null;
  const caption = `Backup Palestra · ${dmy(now)}\n${n === 1 ? "1 allenamento" : n + " allenamenti"}${last ? " · ultimo " + last.slice(8, 10) + "/" + last.slice(5, 7) : ""} · scheda di ${nDays === 1 ? "1 giornata" : nDays + " giornate"}`
    + `\nPer ripristinarlo: app Palestra → Impostazioni → Backup e dati → Importa questo file.`;
  return { json: JSON.stringify(file), name: `palestra-backup-${ymd(now)}.json`, caption, sessions: n };
}

/* manda il backup del codice alla chat collegata e annota l'esito */
export async function sendBackup(store, code, conf, now = Date.now()) {
  const data = await store.get("u-" + code, { type: "json" });
  if (!data) throw new Error("Nessun dato sincronizzato con questo codice");
  const b = buildBackup(data, now);
  const fd = new FormData();
  fd.append("chat_id", conf.chatId);
  fd.append("caption", b.caption);
  fd.append("document", new Blob([b.json], { type: "application/json" }), b.name);
  await tg(conf.token, "sendDocument", fd);
  return b;
}

/* prossimo invio: il 1° o il 16 del mese alle 07:00 UTC (come la funzione programmata) */
export function nextRun(now = Date.now()) {
  const d = new Date(now);
  for (let m = 0; m < 3; m++) for (const day of [1, 16]) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, day, 7, 0, 0);
    if (t > now) return t;
  }
  return null;
}
