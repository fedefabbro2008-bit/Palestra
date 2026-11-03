import { store, leggi, aggiorna, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, presunti, esc, IMP_DEF, M } from "../lib/core.mjs";

/* Giardino · bot pianificato, ogni 15 minuti (funzione pianificata di Netlify).
   Per ogni bot Telegram collegato:
   - dall'ora del mattino (default 7) manda una volta al giorno il piano, solo se c'è qualcosa da fare;
   - dall'ora della sera (default 19) avvisa una volta se domani arrivano gelo, caldo forte o vento;
   - le innaffiature notificate senza risposta, il giorno dopo, si considerano fatte. */
export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const st = store();
  const { blobs } = await st.list({ prefix: "t-" });
  for (const b of blobs) {
    try { await uno(st, b.key); } catch (e) { console.error(b.key, e?.message || e); }
  }
  return new Response("ok");
};

async function uno(st, tkey) {
  const t = await st.get(tkey, { type: "json" });
  if (!t?.chat_id) return;
  const code = tkey.slice(2);
  const cur = await leggi(st, code);
  if (!cur?.data?.location || !cur.data.plants.length) return;
  const imp = { ...IMP_DEF, ...(cur.data.impostazioni || {}) };
  const { oggi, ora } = oraLocale(t.tz || "Europe/Rome");
  const mattina = ora >= +imp.ora_mattina && ora < 21 && t.ultimo_invio !== oggi;
  const sera = ora >= +imp.ora_sera && ora < 23 && t.ultimo_avviso_sera !== oggi;
  if (!mattina && !sera) return;

  const met = await meteo(cur.data.location.lat, cur.data.location.lon);
  const next = { ...t, tz: met.tz };
  if (mattina) {
    // prima registra come fatte le innaffiature dei giorni scorsi rimaste senza risposta
    let data = cur.data;
    const pres = presunti(t, data, oggi);
    if (pres.length) data = (await aggiorna(st, code, (d) => { for (const e of pres) if (!d.eventi.some((x) => x.id === e.id)) d.eventi.push(e); })).data;
    next.notificati = Object.fromEntries(Object.entries(t.notificati || {}).filter(([d]) => d >= oggi));
    const ap = pianoAttivo(data, met, oggi);
    const { msg, tastiera, daFare } = messaggioMattina(data, ap, oggi);
    if (daFare) {
      await tg(t.token, "sendMessage", { chat_id: t.chat_id, text: msg, parse_mode: "HTML", disable_web_page_preview: true, ...(tastiera.length ? { reply_markup: { inline_keyboard: tastiera } } : {}) });
      next.notificati[oggi] = data.plants.map((p) => ({ id: p.id, g: ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((g) => g.data === oggi) }))
        .filter((x) => x.g?.azione === "innaffia").map((x) => ({ id: x.id, litri: x.g.litri }));
    }
    next.ultimo_invio = oggi;
  }
  if (sera) {
    const domani = met.days.find((d) => d.date === M.addDays(oggi, 1));
    const avv = M.avvisiDomani(cur.data.plants, domani);
    if (avv.length) {
      const ic = { gelo: "🥶", caldo: "🔥", vento: "💨" };
      await tg(t.token, "sendMessage", { chat_id: t.chat_id, parse_mode: "HTML", text: "🌙 <b>Per domani</b>\n" + avv.map((a) => `${ic[a.tipo]} ${esc(a.testo)}`).join("\n") });
    }
    next.ultimo_avviso_sera = oggi;
  }
  await st.setJSON(tkey, next);
}
