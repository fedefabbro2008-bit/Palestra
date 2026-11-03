import { getStore } from "@netlify/blobs";

/* Palestra · sincronizzazione tra dispositivi.
   GET  /api/sync?code=XXXX   -> i dati salvati per quel codice, oppure {}
   POST /api/sync?code=XXXX   -> salva; il corpo porta baseRev = la versione da cui è partito il dispositivo.
                                 Se nel frattempo un altro dispositivo ha salvato (rev diversa) risponde 409
                                 con i dati attuali: l'app li unisce ai suoi e riprova. Niente si sovrascrive al buio.
   La scrittura è condizionata all'etag letto (onlyIfMatch / onlyIfNew): due salvataggi nello stesso istante
   non possono cancellarsi a vicenda, il secondo riceve 409.
   Il codice è la chiave: chi lo conosce legge e scrive, per questo l'app ne genera uno lungo e casuale.

   Chiave per Claude (connettore MCP, vedi mcp.mjs): casuale e diversa dal codice, così chi la ha non risale al codice
   e non tocca lo storico; legge sempre, modifica la scheda solo se lo permetti. La gestisce solo chi ha il codice:
   GET  /api/sync?code=XXXX&op=mcp                       -> { active, token, write }
   POST /api/sync?code=XXXX&op=mcp  {action:"on"}        -> crea la chiave (o rende quella che c'è già)
                                    {action:"new"}       -> nuova chiave: quella di prima smette subito di funzionare
                                    {action:"off"}       -> revoca
                                    {action:"write", on} -> Claude può modificare la scheda (on: true) o solo leggere
   In archivio: "m-<codice>" -> { token, write } e "r-<chiave>" -> { code } (il server la usa per trovare i dati).
   Le modifiche di Claude (mcp.mjs) lasciano nei dati un segno "claude": qui si conserva, così anche gli altri
   dispositivi sanno che la scheda l'ha cambiata Claude e offrono «Rimetti com'era». */

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BYTES = 5 * 1024 * 1024;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const TOKEN_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// 26 caratteri da 5 bit (256 è multiplo di 32: tutti ugualmente probabili) = 130 bit casuali
function newToken() { const b = new Uint8Array(26); crypto.getRandomValues(b); return Array.from(b, (x) => TOKEN_ALPHA[x & 31]).join(""); }

async function mcpKey(request, store, code) {
  const mkey = "m-" + code;
  let cur = null, etag = null;
  try { const f = await store.getWithMetadata(mkey, { type: "json" }); if (f) { cur = f.data; etag = f.etag || null; } }
  catch (e) { return reply({ error: "lettura non riuscita" }, 503); }
  const on = cur && typeof cur.token === "string";
  const state = (c) => ({ active: true, token: c.token, at: c.at || 0, write: c.write === true });
  if (request.method === "GET") return reply(on ? state(cur) : { active: false });
  let body = null;
  try { body = await request.json(); } catch (e) { return reply({ error: "JSON non valido" }, 400); }
  const action = body && body.action;
  if (!["on", "new", "off", "write"].includes(action)) return reply({ error: "azione non valida" }, 400);
  if (action === "on" && on) return reply(state(cur));
  if (action === "off") {
    try { if (on) await store.delete("r-" + cur.token); await store.delete(mkey); } catch (e) { return reply({ error: "revoca non riuscita" }, 500); }
    return reply({ active: false });
  }
  if (action === "write") {
    if (!on) return reply({ error: "collegamento non attivo" }, 409);
    if (typeof body.on !== "boolean") return reply({ error: "on deve essere true o false" }, 400);
    const next = { ...cur, write: body.on };
    try {
      const res = await store.setJSON(mkey, next, etag ? { onlyIfMatch: etag } : {});
      if (res && res.modified === false) return reply({ error: "riprova" }, 409);   // cambiata nello stesso istante altrove
    } catch (e) { return reply({ error: "salvataggio non riuscito" }, 500); }
    return reply(state(next));
  }
  // nuova chiave: solo per un codice che ha dati sincronizzati
  try { if (!(await store.getMetadata("u-" + code))) return reply({ error: "nessun dato sincronizzato con questo codice" }, 404); }
  catch (e) { return reply({ error: "lettura non riuscita" }, 503); }
  const token = newToken(), at = Date.now();
  // la chiave nuova tiene il permesso di modificare di quella di prima; una chiave appena creata solo legge
  const next = { token, at, write: !!(on && cur.write === true) };
  try {
    await store.setJSON("r-" + token, { code, at });
    // condizionata: due dispositivi che creano la chiave nello stesso momento non lasciano una chiave orfana valida
    const res = await store.setJSON(mkey, next, on && etag ? { onlyIfMatch: etag } : (on ? {} : { onlyIfNew: true }));
    if (res && res.modified === false) {
      await store.delete("r-" + token);
      const now = await store.get(mkey, { type: "json" });
      return now && now.token ? reply(state(now)) : reply({ error: "riprova" }, 409);
    }
    if (on) await store.delete("r-" + cur.token);   // la chiave di prima non vale più
  } catch (e) { return reply({ error: "salvataggio non riuscito" }, 500); }
  return reply(state(next));
}

function cleanCode(raw) {
  const c = String(raw || "").trim().toUpperCase();
  return /^[A-Z0-9-]{16,64}$/.test(c) ? c : null;
}

export default async (request) => {
  const code = cleanCode(new URL(request.url).searchParams.get("code"));
  if (!code) return reply({ error: "codice mancante o non valido" }, 400);
  if (request.method !== "GET" && request.method !== "POST") return reply({ error: "metodo non consentito" }, 405);
  const store = getStore({ name: "palestra-sync", consistency: "strong" });
  if (new URL(request.url).searchParams.get("op") === "mcp") return mcpKey(request, store, code);
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
    // l'ultima modifica di Claude alla scheda (mcp.mjs): resta, l'app la mostra solo finché la scheda è quella di Claude
    claude: current && current.claude && typeof current.claude === "object" && !Array.isArray(current.claude) ? current.claude : undefined,
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
