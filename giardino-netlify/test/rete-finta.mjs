// Open-Meteo e Telegram finti: meteo fisso (oggi ±), risposte di Telegram registrate in `inviati`.
export const iso = (d) => d.toISOString().slice(0, 10);
export const giorni = []; for (let i = -3; i < 8; i++) { const d = new Date(); d.setUTCDate(d.getUTCDate() + i); giorni.push(iso(d)); }
export const OGGI = giorni[3];
export const inviati = [];
export const meteo = { tmin: giorni.map((_, i) => (i === 4 ? 2 : 12)), tmax: giorni.map(() => 24), pioggia: giorni.map(() => 0), et0: giorni.map(() => 4) };
const vero = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.includes("api.open-meteo.com")) {
    // ICON-2I: nei test niente dati (resta il modello di partenza, così i numeri attesi non cambiano)
    if (url.includes("models=italia")) return Response.json({ hourly: { time: [], precipitation: [], temperature_2m: [] } });
    const ore = giorni.slice(3, 5).flatMap((d) => [...Array(24)].map((_, h) => d + "T" + String(h).padStart(2, "0") + ":00"));
    return Response.json({ timezone: "UTC",
      daily: { time: giorni, weather_code: giorni.map(() => 1), temperature_2m_max: meteo.tmax, temperature_2m_min: meteo.tmin, precipitation_sum: meteo.pioggia, precipitation_probability_max: giorni.map(() => 5), et0_fao_evapotranspiration: meteo.et0, wind_speed_10m_max: giorni.map(() => 10) },
      hourly: { time: ore, temperature_2m: ore.map((_, i) => (i >= 24 && i < 32 ? 1 : 8)), soil_moisture_0_to_1cm: ore.map(() => 0.2), soil_moisture_1_to_3cm: ore.map(() => 0.2), soil_moisture_3_to_9cm: ore.map(() => 0.2), soil_moisture_9_to_27cm: ore.map(() => 0.2) } });
  }
  if (url.includes("api.telegram.org")) {
    const m = url.split("/").pop(); const body = opt.body && typeof opt.body === "string" ? JSON.parse(opt.body) : {};
    inviati.push([m, body]);
    if (m === "getMe") return Response.json({ ok: true, result: { username: "giardino_prova_bot" } });
    return Response.json({ ok: true, result: { message_id: 5 } });
  }
  return vero(url, opt);
};
