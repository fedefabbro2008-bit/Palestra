import { getStore } from "@netlify/blobs";
import { sendBackup } from "../lib/telegram.mjs";

/* Palestra · backup su Telegram due volte al mese: il 1° e il 16 alle 07:00 UTC (08:00 in Italia d'inverno, 09:00
   d'estate). Per ogni codice di sincronizzazione con Telegram collegato (Impostazioni → Backup su Telegram) manda il
   file di backup dei dati sincronizzati. Gira anche con l'app chiusa. */

export default async () => {
  const store = getStore({ name: "palestra-sync", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "t-" });
  let ok = 0, ko = 0;
  for (const { key } of blobs) {
    const code = key.slice(2);
    let conf = null, etag = null;
    try { const f = await store.getWithMetadata(key, { type: "json" }); if (f) { conf = f.data; etag = f.etag || null; } } catch (e) { conf = null; }
    if (!conf || !conf.token || !conf.chatId) continue;
    const at = Date.now();
    let last;
    try { await sendBackup(store, code, conf, at); last = { at, ok: true }; ok++; }
    catch (e) { last = { at, ok: false, error: String((e && e.message) || "errore").slice(0, 200) }; ko++; }
    // condizionata: scollegato nel frattempo dall'app, non si ricrea
    try { await store.setJSON(key, { ...conf, last }, etag ? { onlyIfMatch: etag } : {}); } catch (e) { /* l'esito si perde, il backup no */ }
  }
  console.log(`backup Telegram: ${ok} inviati, ${ko} non riusciti`);
};

export const config = { schedule: "0 7 1,16 * *" };
