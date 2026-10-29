import { getStore } from "@netlify/blobs";

/* Palestra · sincronizzazione tra dispositivi.
   GET  /api/sync?code=XXXX   -> i dati salvati per quel codice, oppure {}
   POST /api/sync?code=XXXX   -> salva; il corpo porta baseRev = la versione da cui è partito il dispositivo.
                                 Se nel frattempo un altro dispositivo ha salvato (rev diversa) risponde 409
                                 con i dati attuali: l'app li unisce ai suoi e riprova. Niente si sovrascrive al buio.
   La scrittura è condizionata all'etag letto (onlyIfMatch / onlyIfNew): due salvataggi nello stesso istante
   non possono cancellarsi a vicenda, il secondo riceve 409.
   Il codice è la chiave: chi lo conosce legge e scrive, per questo l'app ne genera uno lungo e casuale. */

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BYTES = 5 * 1024 * 1024;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function cleanCode(raw) {
  const c = String(raw || "").trim().toUpperCase();
  return /^[A-Z0-9-]{16,64}$/.test(c) ? c : null;
}

export default async (request) => {
  const code = cleanCode(new URL(request.url).searchParams.get("code"));
  if (!code) return reply({ error: "codice mancante o non valido" }, 400);
  if (request.method !== "GET" && request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
  const store = getStore({ name: "palestra-sync", consistency: "strong" });
  const key = "u-" + code;

  // lettura fallita: errore, mai "vuoto" (l'app penserebbe che hai cancellato tutto)
  let current = null, etag = null;
  try {
    const found = await store.getWithMetadata(key, { type: "json" });
    if (found) { current = found.data; etag = found.etag || null; }
  } catch (e) { return reply({ error: "lettura non riuscita" }, 503); }

  if (request.method === "GET") return reply(current || {});

  let raw = "";
  try { raw = await request.text(); } catch (e) { return reply({ error: "corpo illeggibile" }, 400); }
  if (!raw) return reply({ error: "corpo vuoto" }, 400);
  if (raw.length > MAX_BYTES) return reply({ error: "dati troppo grandi" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return reply({ error: "JSON non valido" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "atteso un oggetto" }, 400);

  const rev = (current && Number(current.rev)) || 0;
  if (Number(body.baseRev || 0) !== rev) return reply(current || {}, 409);

  const data = {
    v: 1, rev: rev + 1, at: Date.now(),
    logs: body.logs && typeof body.logs === "object" ? body.logs : {},
    days: body.days && typeof body.days === "object" ? body.days : null,
    daysAt: Number(body.daysAt) || 0,
    settings: body.settings && typeof body.settings === "object" ? body.settings : null,
    setAt: Number(body.setAt) || 0,
    wid: typeof body.wid === "string" ? body.wid.slice(0, 40) : null,   // chi ha scritto: l'app riconosce se la versione è davvero la sua
  };
  let res;
  // con l'etag la scrittura è atomica; se il negozio non lo fornisce (es. in locale) resta il controllo sulla rev
  const cond = current ? (etag ? { onlyIfMatch: etag } : {}) : { onlyIfNew: true };
  try { res = await store.setJSON(key, data, cond); }
  catch (e) { return reply({ error: "salvataggio non riuscito" }, 500); }
  if (res && res.modified === false) {
    // un altro dispositivo ha salvato fra la lettura e la scrittura: gli si mandano i dati nuovi da unire
    let fresh = null;
    try { fresh = await store.get(key, { type: "json" }); } catch (e) { fresh = null; }
    return reply(fresh || {}, 409);
  }
  return reply({ ok: true, rev: data.rev, at: data.at, wid: data.wid });
};

export const config = { path: "/api/sync" };
