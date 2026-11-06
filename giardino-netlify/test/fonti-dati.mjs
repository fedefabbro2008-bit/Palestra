// Giardino · prova informativa (non blocca): fonti di dati candidate, viste da GitHub (che raggiunge Internet).
const UA = "giardino-fede.netlify.app/1.0 https://giardino-fede.netlify.app";
const P = { lat: 44.18, lon: 11.95 };   // Castrocaro / Forlì
const mostra = async (nome, url, opz = {}, n = 1200) => {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...(opz.headers || {}) }, method: opz.method || "GET" });
    const t = opz.method === "HEAD" ? "" : await r.text();
    console.log(`\n=== ${nome} → ${r.status} ${r.headers.get("content-type") || ""} len=${r.headers.get("content-length") || t.length} cors=${r.headers.get("access-control-allow-origin")}`);
    if (t && n) console.log(t.slice(0, n).replace(/\s+/g, " "));
    return t;
  } catch (e) { console.log(`\n=== ${nome} → errore ${e.message}`); return ""; }
};
const met = await mostra("MET complete", `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${P.lat}&lon=${P.lon}`, {}, 0);
try { const j = JSON.parse(met), ts = j.properties.timeseries;
  console.log("timeseries", ts.length, "da", ts[0].time, "a", ts.at(-1).time);
  console.log("primo", JSON.stringify(ts[0]).slice(0, 900));
  const passi = ts.slice(1).map((x, i) => (Date.parse(x.time) - Date.parse(ts[i].time)) / 36e5); console.log("passi (h)", [...new Set(passi)].join(","));
  const t6 = ts.find((x) => x.data.next_6_hours && !x.data.next_1_hours); console.log("solo 6 ore", JSON.stringify(t6).slice(0, 600));
} catch (e) { console.log("MET non leggibile", e.message); }
await mostra("ARPAE realtime dir", "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/", {}, 2500);
await mostra("ARPAE osservati dir", "https://dati-simc.arpae.it/opendata/osservati/meteo/", {}, 2500);
const rt = await mostra("ARPAE realtime.jsonl", "https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl", {}, 1500);
if (rt) { const righe = rt.split("\n").filter(Boolean); console.log("righe", righe.length, "byte", rt.length);
  const vic = new Map();
  for (const l of righe) { try { const o = JSON.parse(l), lat = o.lat / 1e5, lon = o.lon / 1e5, d = Math.hypot((lat - P.lat) * 111, (lon - P.lon) * 80);
    if (d < 25) { const k = `${lat},${lon}`; const v = vic.get(k) || { d: +d.toFixed(1), n: 0, pioggia: 0, nomi: new Set(), date: new Set(), tr: new Set() }; v.n++;
      for (const x of o.data || []) { if (x.vars?.B01019) v.nomi.add(x.vars.B01019.v); if (x.vars?.B13011) { v.pioggia++; v.tr.add(JSON.stringify(x.timerange)); v.date.add(String(o.date).slice(0, 13)); } } vic.set(k, v); } } catch {} }
  for (const [k, v] of vic) console.log("vicina", k, v.d, "km", [...v.nomi].join("/"), "righe", v.n, "pioggia", v.pioggia, "timerange", [...v.tr].slice(0, 3).join(" "), "ore", [...v.date].sort().slice(0, 2).join(" "), "…", [...v.date].sort().slice(-1));
}
await mostra("ARPAE CKAN", "https://dati.arpae.it/api/3/action/package_search?q=osservati%20meteo&rows=5", {}, 2500);
await mostra("Open-Meteo sole", `https://api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}&timezone=auto&past_days=2&forecast_days=3&daily=sunshine_duration,daylight_duration,temperature_2m_mean`, {}, 900);
await mostra("Open-Meteo past_days 92", `https://api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}&timezone=auto&past_days=92&forecast_days=1&daily=temperature_2m_mean`, {}, 300);
await mostra("Open-Meteo archivio", `https://archive-api.open-meteo.com/v1/archive?latitude=${P.lat}&longitude=${P.lon}&timezone=auto&start_date=2026-08-01&end_date=2026-11-05&daily=temperature_2m_mean`, {}, 300);
const hf = await mostra("Open-Meteo storico previsioni", `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}&timezone=auto&start_date=2026-03-01&end_date=2026-11-05&daily=temperature_2m_mean`, {}, 300);
try { const d = JSON.parse(hf).daily; const ok = d.time.filter((_, i) => d.temperature_2m_mean[i] != null); console.log("storico: giorni", d.time.length, "con dato", ok.length, "ultimo", ok.at(-1)); } catch {}
