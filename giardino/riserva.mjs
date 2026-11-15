// Giardino · bot di riserva su GitHub (gira ogni mattina con GitHub Actions, gratis).
// - Se il sito risponde: scarica i dati (GIARDINO_CODE) e ne salva una copia cifrata (AES-256-GCM, chiave dal codice)
//   nella cache di GitHub Actions, che non è pubblica.
// - Se il sito non risponde (per esempio in pausa perché i crediti Netlify sono finiti): con l'ultima copia calcola il
//   piano di oggi con lo stesso codice del sito e manda il messaggio del mattino su Telegram (GIARDINO_TG_TOKEN e
//   GIARDINO_TG_CHAT). I pulsanti non funzionano finché il sito è fermo: il messaggio lo dice.
// Si lancia dalla cartella giardino-netlify:  node --import ./test/registra-finto.mjs ../giardino/riserva.mjs
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

const chiave = (code) => createHash("sha256").update("giardino-riserva:" + code).digest();
export function cifra(obj, code) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", chiave(code), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") });
}
export function decifra(testo, code) {
  const o = JSON.parse(testo), d = createDecipheriv("aes-256-gcm", chiave(code), Buffer.from(o.iv, "base64"));
  d.setAuthTag(Buffer.from(o.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(o.data, "base64")), d.final()]).toString("utf8"));
}
async function sitoVivo(sito, tentativi, attesa) {
  for (let i = 0; i < tentativi; i++) {
    try { const r = await fetch(sito + "/api/dati?op=versione", { signal: AbortSignal.timeout(20000) }); if (r.ok && (await r.json()).versione) return true; } catch {}
    if (i < tentativi - 1) await new Promise((x) => setTimeout(x, attesa));
  }
  return false;
}
export async function riserva({ sito, codice, token, chat, file, tentativi = 3, attesa = 60000, log = console.log }) {
  if (!codice) { log("GIARDINO_CODE non impostato: niente copia e niente riserva."); return { azione: "niente" }; }
  if (await sitoVivo(sito, tentativi, attesa)) {
    const r = await fetch(sito + "/api/dati", { headers: { "x-giardino-code": codice } });
    const j = r.ok ? await r.json() : null;
    if (!j?.data) { log("Sito vivo ma dati non leggibili: tengo la copia di prima."); return { azione: "niente" }; }
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, cifra({ at: new Date().toISOString(), data: j.data }, codice));
    log("Sito vivo: copia dei dati aggiornata (cifrata)."); return { azione: "copia" };
  }
  log("Il sito non risponde: bot di riserva.");
  if (!token || !chat) { log("GIARDINO_TG_TOKEN o GIARDINO_TG_CHAT non impostati: non posso scrivere su Telegram."); return { azione: "niente" }; }
  let copia; try { copia = decifra(await readFile(file, "utf8"), codice); } catch { log("Nessuna copia dei dati disponibile."); return { azione: "niente" }; }
  const C = await import("../giardino-netlify/netlify/lib/core.mjs");
  const data = { ...C.vuoto(), ...copia.data };
  if (!C.M.vistePiene(data).length) { log("Copia senza posizione o piante."); return { azione: "niente" }; }
  // un messaggio per orto (città), ognuno con il suo meteo
  const msg = (await C.pianiOrti(data)).map((x) => C.messaggioMattina(x.v, x.ap, x.oggi, { prova: true }).msg).join("\n\n— — —\n\n");
  const testo = "⚠️ <b>Il sito Giardino non risponde</b> (forse è in pausa perché i crediti Netlify sono finiti). Questo messaggio arriva dalla copia di riserva su GitHub, con i dati del " +
    new Date(copia.at).toLocaleDateString("it-IT", { day: "numeric", month: "long" }) + ". I pulsanti non funzionano: quando il sito torna, segna nell'app quello che hai fatto.\n\n" + msg;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: testo, parse_mode: "HTML", disable_web_page_preview: true }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error("Telegram: " + (j.description || r.status));
  log("Messaggio di riserva inviato."); return { azione: "telegram" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = process.env, out = await riserva({ sito: (e.SITO || "https://giardino-fede.netlify.app").replace(/\/$/, ""), codice: e.GIARDINO_CODE, token: e.GIARDINO_TG_TOKEN, chat: e.GIARDINO_TG_CHAT,
    file: e.FILE_RISERVA || "riserva/dati.enc" });
  if (e.GITHUB_OUTPUT) await appendFile(e.GITHUB_OUTPUT, `azione=${out.azione}\n`);
}
