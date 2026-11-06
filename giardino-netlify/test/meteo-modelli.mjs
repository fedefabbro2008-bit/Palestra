// Giardino · prova informativa (non blocca): quali modelli di Open-Meteo rispondono per l'Italia e con quali dati.
// Serve a controllare il modello italiano ICON-2I (ItaliaMeteo-ARPAE) usato per la pioggia dei primi giorni.
const LUOGO = { latitude: 44.49, longitude: 11.34 };   // Bologna: punto di prova qualsiasi in Emilia-Romagna
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max,wind_gusts_10m_max";
for (const models of ["best_match", "italia_meteo_arpae_icon_2i", "icon_d2", "icon_seamless"]) {
  const q = new URLSearchParams({ ...LUOGO, timezone: "auto", forecast_days: "4", daily: DAILY, models });
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?" + q), j = await r.json();
    if (!r.ok) { console.log(models, "→", r.status, j.reason || ""); continue; }
    console.log(models, "→ ok");
    for (const k of DAILY.split(",")) console.log("   ", k.padEnd(32), JSON.stringify(j.daily[k]));
  } catch (e) { console.log(models, "→ errore", e.message); }
}
