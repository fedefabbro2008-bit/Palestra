// Giardino · controllo del sito online (GitHub Actions, dopo ogni pubblicazione e una volta al giorno).
// 1. aspetta che Netlify serva la versione di questo commit (impronta in netlify/lib/versione.mjs);
// 2. prova pagina, app installabile, dati, connettore di Claude e webhook di Telegram senza credenziali
//    (devono rispondere e rifiutare: così si vede che le funzioni sono vive senza toccare i dati);
// 3. se nei segreti del repository ci sono GIARDINO_CODE e/o GIARDINO_MCP, prova anche in sola lettura i dati veri.
// Nessuna scrittura. Poche richieste: costo per Netlify trascurabile. Uscita ≠ 0 = qualcosa non va (GitHub manda l'email).
import { readFile } from "node:fs/promises";

const SITO = (process.env.SITO || "https://giardino-fede.netlify.app").replace(/\/$/, "");
const ATTESA = +(process.env.ATTESA_MINUTI || 12) * 60_000;
const atteso = (await readFile(new URL("../netlify/lib/versione.mjs", import.meta.url), "utf8")).match(/VERSIONE = "([0-9a-f]+)"/)[1];
const errori = [];
const prova = async (nome, fn) => { try { await fn(); console.log("✔", nome); } catch (e) { errori.push(nome); console.log("✘", nome, "—", e.message); } };
const deve = (cond, msg) => { if (!cond) throw new Error(msg); };
const chiedi = (path, opt = {}) => fetch(SITO + path, { redirect: "manual", ...opt, headers: { "user-agent": "giardino-controllo", ...(opt.headers || {}) } });

// 1. versione
const inizio = Date.now(); let online = "";
for (;;) {
  try { online = (await (await chiedi("/api/dati?op=versione")).json()).versione || ""; } catch { online = ""; }
  if (online === atteso) break;
  if (Date.now() - inizio > ATTESA) break;
  console.log(`versione online ${online || "?"}, attesa ${atteso}: riprovo tra 30 s`);
  await new Promise((r) => setTimeout(r, 30_000));
}
await prova(`versione online = ${atteso}`, () => deve(online === atteso, `online c'è ${online || "niente"} (pubblicazione non riuscita, sito in pausa o crediti finiti?)`));

// 2. senza credenziali
await prova("pagina dell'app", async () => { const r = await chiedi("/"); const t = await r.text(); deve(r.status === 200, "stato " + r.status); deve(/<title>[^<]*Giardino/i.test(t), "titolo mancante"); });
await prova("app installabile (manifest e service worker)", async () => {
  const m = await chiedi("/manifest.webmanifest"); deve(m.status === 200 && (await m.json()).name, "manifest " + m.status);
  const s = await chiedi("/sw.js"); deve(s.status === 200, "sw.js " + s.status);
});
await prova("dati: senza codice rifiuta", async () => { const r = await chiedi("/api/dati"); deve(r.status === 400 && (await r.json()).error, "stato " + r.status); });
await prova("connettore di Claude: chiave sbagliata rifiutata", async () => {
  const r = await chiedi("/mcp/AAAAAAAAAAAAAAAAAAAAAAAAAA", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  deve(r.status === 401, "stato " + r.status);
});
await prova("Telegram: webhook sconosciuto rifiutato", async () => { const r = await chiedi("/api/telegram/" + "A".repeat(32), { method: "POST", body: "{}" }); deve(r.status === 403, "stato " + r.status); });

// 3. con i segreti (facoltativi), sola lettura
const CODE = process.env.GIARDINO_CODE, MCP = process.env.GIARDINO_MCP;
if (CODE) {
  const H = { "x-giardino-code": CODE };
  await prova("dati veri leggibili", async () => { const r = await chiedi("/api/dati", { headers: H }); const j = await r.json(); deve(r.status === 200 && j.data?.plants?.length, "stato " + r.status); });
} else console.log("– GIARDINO_CODE non impostato: salto le prove sui dati veri");
if (MCP) {
  await prova("connettore di Claude: strumento giardino", async () => {
    const r = await chiedi("/mcp/" + MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "giardino", arguments: {} } }) });
    const t = await r.text(); deve(r.status === 200 && /Meteo/.test(t) && !/"isError":\s*true/.test(t), "stato " + r.status);
  });
} else console.log("– GIARDINO_MCP non impostato: salto la prova del connettore con la chiave vera");

if (errori.length) { console.log(`\n${errori.length === 1 ? "1 controllo non riuscito" : errori.length + " controlli non riusciti"}: ${errori.join("; ")}`); process.exit(1); }
console.log("\nSito online a posto.");
