// Giardino · sonda informativa (non blocca): gli algoritmi con i dati veri di Open-Meteo per Castrocaro.
//   1. le tre richieste dell'app e del bot (base, più modelli, storico) lette da componiMeteo / archivioDa
//   2. il bilancio dell'acqua con memoria e le fasi su piante di esempio
const M = await import("../netlify/lib/modello.mjs");
const lat = 44.176, lon = 11.95, u = M.urlMeteo(lat, lon);
const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ora = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date());
const prendi = async (url) => { try { const r = await fetch(url); return r.ok ? await r.json() : (console.log("  →", r.status, url.slice(0, 80)), null); } catch (e) { console.log("  → errore", e.message); return null; } };
const [j, jMod, jSt] = await Promise.all([prendi(u.base), prendi(u.modelli), prendi(M.urlStorico(lat, lon, oggi))]);
if (!j) { console.log("Open-Meteo non risponde"); process.exit(0); }
const met = { lat, ...M.componiMeteo(j, null, oggi, ora, jMod), storico: jSt ? M.storicoDa(jSt) : null, archivio: jSt ? M.archivioDa(jSt) : null };
console.log("più modelli:", jMod ? "ok" : "no", "· giorni", met.days.length, "· storico", Object.keys(met.storico || {}).length, "giorni · archivio", JSON.stringify(met.archivio || {}).length, "byte");
for (const d of met.days.filter((x) => x.date >= oggi)) console.log("  ", d.date, d.cond.padEnd(14), "pioggia", String(d.rain).padStart(5), "mm", ("(" + d.prob + "%)").padEnd(6),
  d.ensemble ? "modelli " + d.modelli.length + " [" + d.rain_modelli.join("/") + "] min " + d.tmin + (d.tmin_freddo < d.tmin ? " (più freddo " + d.tmin_freddo + ")" : "") + " et0 " + d.et0 : "base");
M.registraClima(lat, M.climaDa(met));
const past = M.giorniPassati(met, null, oggi);
console.log("giorni passati per il bilancio:", past.length, "dal", past[0]?.date, "· pioggia totale", past.reduce((a, d) => a + (d.rain || 0), 0).toFixed(0), "mm · ET0 totale", past.reduce((a, d) => a + (d.et0 || 0), 0).toFixed(0), "mm");
const piante = [
  { id: "agl", nome: "Aglio", specie: "aglio", fase: "auto", data_semina: "2026-11-03", tipo_data: "semina", colt: "vaso", vaso: 30, num: 4, luce: 4, dove: "aperto", orient: "S", luce_data: "2026-11-06" },
  { id: "car", nome: "Carote", specie: "carota", fase: "auto", data_semina: "2026-11-06", tipo_data: "semina", colt: "vaso", vaso: 50, num: 14, luce: 4, dove: "aperto", materiale: "terracotta" },
  { id: "chl", nome: "Chlorophytum", specie: "appartamento", fase: "auto", colt: "vaso", vaso: 0.3, diametro: 7, luce: 1, dove: "interno" },
  { id: "nep", nome: "Nepenthes", specie: "nepenthes", fase: "auto", colt: "vaso", vaso: 12, diametro: 30, luce: 2, dove: "serra" },
  { id: "suc", nome: "Succulenta", specie: "succulenta", fase: "auto", colt: "vaso", vaso: 2, luce: 4, dove: "interno" }];
const eventi = piante.map((p) => ({ id: "f" + p.id, plantId: p.id, tipo: "fatto", data: M.addDays(oggi, -12), fonte: "app" }));
const fut = met.days.filter((d) => d.date >= oggi).slice(0, 7);
for (const [nome, ev] of [["con un'innaffiatura 12 giorni fa", eventi], ["senza nessun evento", []]]) {
  const pl = M.pianoLocale({ piante, past, fut, eventi: ev, oggi, lat, suolo: met.suolo });
  console.log("piano", nome + ":");
  for (const x of pl.piante) console.log("   ", piante.find((p) => p.id === x.id).nome.padEnd(13), "acqua", String(Math.round(x.acqua * 100)).padStart(3) + "%", "· dal", String(x.dal).padEnd(10), "·", x.valutazione);
}
for (const p of piante.slice(0, 2)) { const f = M.faseEffettiva(p, oggi, lat), e = M.etaPianta(p, oggi, lat); console.log("fase", p.nome, f.fase, "· età tipica", e.eta, "· ritmo", e.ritmo, f.nota || ""); }
console.log("calendario aglio:", M.calendarioAuto(piante[0], lat).mesi.map((m) => m.mese.slice(2) + " " + m.fase.slice(0, 4)).join(", "));
// ARPAE: il file arriva compresso? (9 MB in chiaro; compresso sarebbe ~1 MB e «Sotto la pioggia» si aprirebbe prima)
for (const h of [{}, { "accept-encoding": "gzip, br" }]) {
  try { const t0 = Date.now(), r = await fetch("https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl", { headers: { "user-agent": "giardino-fede.netlify.app/1.0 https://giardino-fede.netlify.app", ...h } });
    const testo = await r.text(); console.log("ARPAE", JSON.stringify(h), "→", r.status, "codifica", r.headers.get("content-encoding"), "· lunghezza dichiarata", r.headers.get("content-length"), "· testo", testo.length, "· ms", Date.now() - t0); }
  catch (e) { console.log("ARPAE → errore", e.message); }
}
