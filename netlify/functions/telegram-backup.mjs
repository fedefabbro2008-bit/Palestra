import { getStore } from "@netlify/blobs";
import { sendBackup, isDue } from "../lib/telegram.mjs";

/* Palestra · backup su Telegram. Gira ogni giorno alle 07:00 UTC (08:00 in Italia d'inverno, 09:00 d'estate) e, per ogni
   codice di sincronizzazione con Telegram collegato (Impostazioni → Backup su Telegram), manda il file di backup dei dati
   sincronizzati solo se quel giorno tocca con la frequenza scelta (ogni giorno, ogni lunedì, il 1° e il 16, il 1° del
   mese). Gira anche con l'app chiusa. Un backup già arrivato nelle ultime 12 ore (es. «Invia ora») non si ripete. */

const GAP = 12 * 3600 * 1000;
export async function runBackups(now = Date.now()) {
  const store = getStore({ name: "palestra-sync", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "t-" });
  let ok = 0, ko = 0;
  for (const { key } of blobs) {
    const code = key.slice(2);
    let conf = null, etag = null;
    try { const f = await store.getWithMetadata(key, { type: "json" }); if (f) { conf = f.data; etag = f.etag || null; } } catch (e) { conf = null; }
    if (!conf || !conf.token || !conf.chatId) continue;
    if (!isDue(conf.freq, now)) continue;
    const ago = now - Number((conf.last && conf.last.ok && conf.last.at) || 0);
    if (ago >= 0 && ago < GAP) continue;
    const at = Date.now();
    let last;
    try { await sendBackup(store, code, conf, at); last = { at, ok: true }; ok++; }
    catch (e) { last = { at, ok: false, error: String((e && e.message) || "errore").slice(0, 200) }; ko++; }
    // condizionata: scollegato nel frattempo dall'app, non si ricrea
    try { await store.setJSON(key, { ...conf, last }, etag ? { onlyIfMatch: etag } : {}); } catch (e) { /* l'esito si perde, il backup no */ }
  }
  console.log(`backup Telegram: ${ok} inviati, ${ko} non riusciti`);
  return { ok, ko };
}

export default async () => { await runBackups(Date.now()); };

export const config = { schedule: "0 7 * * *" };
