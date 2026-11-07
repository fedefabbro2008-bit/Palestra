// Giardino · sonda informativa (non blocca): controlla le fonti di dati usate dagli algoritmi.
//   1. Open-Meteo con più modelli nella stessa richiesta (giornaliero con il suffisso del modello)
//   2. storico giornaliero completo (temperature, pioggia, evaporazione, sole) dall'archivio delle previsioni
//   3. ARPAE: variabili misurate dalla stazione più vicina a Castrocaro (temperatura, pioggia, umidità…)
const LUOGO = { latitude: 44.176, longitude: 11.95 };   // Castrocaro Terme
const oggi = new Date().toISOString().slice(0, 10), giorno = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const MODELLI = ["ecmwf_ifs025", "ecmwf_ifs", "icon_seamless", "gfs_seamless", "meteofrance_seamless", "italia_meteo_arpae_icon_2i", "ukmo_seamless"];
const DAILY = "precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,precipitation_probability_max";
async function prova(nome, url) {
  try { const r = await fetch(url), j = await r.json().catch(() => null); return { ok: r.ok, status: r.status, j, motivo: j?.reason || "" }; }
  catch (e) { console.log(nome, "→ errore", e.message); return { ok: false }; }
}
// 1a. un modello alla volta: quali rispondono
for (const m of MODELLI) {
  const r = await prova(m, "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({ ...LUOGO, timezone: "auto", forecast_days: "8", daily: DAILY, models: m }));
  if (!r.ok) { console.log("modello", m, "→", r.status, r.motivo); continue; }
  const d = r.j.daily, n = (k) => (d[k] || []).filter((x) => x != null).length;
  console.log("modello", m.padEnd(28), "→ ok · giorni con pioggia", n("precipitation_sum"), "· max", n("temperature_2m_max"), "· et0", n("et0_fao_evapotranspiration"), "· prob", n("precipitation_probability_max"));
  console.log("    pioggia", JSON.stringify(d.precipitation_sum), "max", JSON.stringify(d.temperature_2m_max));
}
// 1b. tutti insieme: nomi delle chiavi nella risposta
{
  const ms = MODELLI.filter((m) => m !== "ecmwf_ifs").join(",");
  const r = await prova("insieme", "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({ ...LUOGO, timezone: "auto", forecast_days: "8", daily: "precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration", models: ms }));
  console.log("più modelli insieme →", r.status, r.motivo, "· chiavi:", r.j?.daily ? Object.keys(r.j.daily).join(" ") : "");
}
// 2. storico giornaliero completo, 400 giorni
{
  const daily = "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,sunshine_duration,daylight_duration";
  const r = await prova("storico", "https://historical-forecast-api.open-meteo.com/v1/forecast?" + new URLSearchParams({ ...LUOGO, timezone: "auto", start_date: giorno(-400), end_date: giorno(-1), daily }));
  if (r.ok) {
    const d = r.j.daily, ultimo = (k) => { for (let i = d.time.length - 1; i >= 0; i--) if (d[k][i] != null) return d.time[i]; return null; };
    console.log("storico →", r.status, "giorni", d.time.length, "· byte", JSON.stringify(r.j).length);
    for (const k of daily.split(",")) console.log("    ", k.padEnd(30), "valori", d[k].filter((x) => x != null).length, "· ultimo", ultimo(k));
    console.log("    ultimi 5 giorni:", d.time.slice(-5).map((t, i) => t + " " + ["precipitation_sum", "et0_fao_evapotranspiration", "temperature_2m_min", "temperature_2m_max"].map((k) => d[k][d.time.length - 5 + i]).join("/")).join(" · "));
  } else console.log("storico →", r.status, r.motivo);
  // archivio ERA5-Land (clima di più anni) per confronto
  const e = await prova("era5", "https://archive-api.open-meteo.com/v1/archive?" + new URLSearchParams({ ...LUOGO, timezone: "auto", start_date: "2016-01-01", end_date: giorno(-7), daily: "temperature_2m_max,temperature_2m_min", models: "era5_land" }));
  console.log("ERA5-Land 10 anni →", e.status, e.motivo, e.ok ? "giorni " + e.j.daily.time.length + " · byte " + JSON.stringify(e.j).length : "");
}
// 3. ARPAE: tutte le variabili delle stazioni entro 15 km
try {
  const r = await fetch("https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl", { headers: { "user-agent": "giardino-fede.netlify.app/1.0 https://giardino-fede.netlify.app" } });
  const testo = await r.text(), cosl = Math.cos(LUOGO.latitude * Math.PI / 180), staz = new Map();
  console.log("ARPAE →", r.status, "byte", testo.length);
  for (const l of testo.split("\n")) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    const km = Math.hypot((o.lat / 1e5 - LUOGO.latitude) * 111, (o.lon / 1e5 - LUOGO.longitude) * 111 * cosl);
    if (!(km <= 15)) continue;
    const k = `${o.network}|${o.lon}|${o.lat}`, s = staz.get(k) || { km: +km.toFixed(1), nome: "", vars: {}, date: new Set() };
    s.date.add(o.date);
    for (const x of o.data || []) for (const [v, val] of Object.entries(x.vars || {})) {
      if (v === "B01019") { s.nome = val.v; continue; }
      const kk = v + " tr" + JSON.stringify(x.timerange || null) + " lv" + JSON.stringify(x.level || null);
      (s.vars[kk] ||= []).push(o.date.slice(5, 16) + "=" + val.v);
    }
    staz.set(k, s);
  }
  for (const [k, s] of [...staz].sort((a, b) => a[1].km - b[1].km)) {
    console.log("stazione", s.nome, s.km + " km", k, "· istanti", s.date.size);
    for (const [v, a] of Object.entries(s.vars)) console.log("    ", v.padEnd(48), a.length, "valori · ultimi:", a.slice(-3).join(" "));
  }
} catch (e) { console.log("ARPAE → errore", e.message); }
