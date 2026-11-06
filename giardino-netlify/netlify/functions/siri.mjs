import { store, leggi, meteo, oraLocale, pianoAttivo, cleanCode, segnaFatte, testoOggi, M } from "../lib/core.mjs";

/* Giardino · Comandi Rapidi di Siri (“Ehi Siri, ho innaffiato”).
   POST /api/siri/oggi[?zona=Balcone]    → testo: cosa innaffiare oggi (accetta anche GET)
   POST /api/siri/fatto[?zona=Balcone]   → segna come annaffiate le piante di oggi, tutte o di una zona
        /api/siri/fatto?pianta=Aglio       → solo quella pianta, anche se oggi non era in programma
   Il codice di sincronizzazione va nell'intestazione x-giardino-code (mai nell'indirizzo).
   Risposte in testo semplice, pronte da far leggere a Siri. */
export const config = { path: "/api/siri/*", rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip", "domain"] } };

const testo = (t, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export default async (request) => {
  const url = new URL(request.url), azione = url.pathname.split("/").filter(Boolean).pop();
  const zona = String(url.searchParams.get("zona") || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const code = cleanCode(request.headers.get("x-giardino-code"));
  if (!code) return testo("Manca il codice di sincronizzazione: aggiungi l'intestazione x-giardino-code con il codice dell'app.", 401);
  if (azione !== "oggi" && azione !== "fatto") return testo("Azione sconosciuta: usa /api/siri/oggi oppure /api/siri/fatto.", 404);
  if (azione === "fatto" && request.method !== "POST") return testo("Per segnare le piante usa il metodo POST.", 405);
  const st = store(), cur = await leggi(st, code);
  if (!cur?.data?.location || !cur.data.plants.length) return testo("Nell'app Giardino mancano ancora la posizione o le piante.");
  if (zona && !cur.data.plants.some((p) => M.zonaDi(p).toLowerCase() === zona.toLowerCase())) return testo(`Non trovo la zona ${zona}.`);
  let met;
  try { met = await meteo(cur.data.location.lat, cur.data.location.lon); }
  catch (e) { console.error("meteo", e?.message); return testo("Non riesco a leggere il meteo adesso: riprova tra poco.", 502); }
  const { oggi } = oraLocale(met.tz), ap = pianoAttivo(cur.data, met, oggi);
  if (azione === "oggi") return testo(testoOggi(cur.data, ap, oggi, { zona }));
  const nomeP = String(url.searchParams.get("pianta") || "").trim().slice(0, 60);
  const p = nomeP ? cur.data.plants.find((x) => x.nome.toLowerCase() === nomeP.toLowerCase()) || cur.data.plants.find((x) => x.nome.toLowerCase().includes(nomeP.toLowerCase())) : null;
  if (nomeP && !p) return testo(`Non trovo la pianta ${nomeP}.`);
  const fatte = await segnaFatte(st, code, ap, oggi, { zona, pianta: p?.id || "", fonte: "siri" });
  return testo(fatte.length ? "Fatto. Ho segnato come annaffiate: " + fatte.join(", ") + "." : "Oggi non c'era niente da innaffiare" + (zona ? " in " + zona : "") + ", oppure l'avevi già segnato.");
};
