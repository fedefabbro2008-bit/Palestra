import { store, leggi, aggiorna, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, presunti, riepilogoSettimana, backup, inviaFile, esc, IMP_DEF, M } from "../lib/core.mjs";

/* Giardino · bot pianificato, ogni ora (funzione pianificata di Netlify).
   Per ogni bot Telegram collegato, all'ora locale:
   - mattino (default dalle 7): una volta al giorno il piano, solo se c'è qualcosa da fare;
   - sera (default dalle 19), una volta al giorno:
       · promemoria delle piante da innaffiare oggi ancora senza risposta;
       · avvisi per domani (gelo con le temperature ora per ora della notte, caldo, vento);
       · la domenica, il riepilogo della settimana;
       · il primo giorno utile di ogni mese, il file di backup;
   - le innaffiature notificate e rimaste senza risposta, il giorno dopo, si considerano fatte. */
export const config = { schedule: "@hourly" };

export default async () => {
  const st = store();
  const { blobs } = await st.list({ prefix: "t-" });
  for (const b of blobs) {
    try { await uno(st, b.key); } catch (e) { console.error(b.key, e?.message || e); }
  }
  return new Response("ok");
};

const ESITI = ["fatto", "secco", "umido", "saltato"];
const corto = (s) => { s = String(s || ""); return s.length > 18 ? s.slice(0, 17) + "…" : s; };

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
  const invia = (text, extra = {}) => tg(t.token, "sendMessage", { chat_id: t.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  let data = cur.data;

  if (mattina) {
    const pres = presunti(t, data, oggi);
    if (pres.length) data = (await aggiorna(st, code, (d) => { for (const e of pres) if (!d.eventi.some((x) => x.id === e.id)) d.eventi.push(e); })).data;
    next.notificati = Object.fromEntries(Object.entries(t.notificati || {}).filter(([d]) => d >= oggi));
    const ap = pianoAttivo(data, met, oggi);
    const { msg, tastiera, daFare } = messaggioMattina(data, ap, oggi);
    if (daFare) {
      await invia(msg, tastiera.length ? { reply_markup: { inline_keyboard: tastiera } } : {});
      next.notificati[oggi] = data.plants.map((p) => ({ id: p.id, g: ap.piano.piante.find((x) => x.id === p.id)?.giorni?.find((g) => g.data === oggi) }))
        .filter((x) => x.g?.azione === "innaffia").map((x) => ({ id: x.id, litri: x.g.litri }));
    }
    next.ultimo_invio = oggi;
  }

  if (sera) {
    // 1. promemoria: piante da innaffiare oggi ancora senza risposta (né dall'app, né da Telegram, né da Claude)
    const fresco = (await leggi(st, code))?.data || data;
    const mancano = (next.notificati?.[oggi] || []).filter((n) => !fresco.eventi.some((e) => e.plantId === n.id && e.data === oggi && ESITI.includes(e.tipo)))
      .map((n) => ({ ...n, p: fresco.plants.find((p) => p.id === n.id) })).filter((n) => n.p);
    if (mancano.length && !M.inVacanza(fresco.vacanza, oggi)) {
      await invia("🔔 <b>Ancora da innaffiare oggi</b>\n" + mancano.map((n) => `💧 ${esc(n.p.nome)}: ${String(n.litri).replace(".", ",")} L (${esc(M.dose(n.litri, imp))})`).join("\n") + "\n<i>Se l'hai già fatto, premi Fatto: altrimenti domani lo conto come fatto.</i>",
        { reply_markup: { inline_keyboard: mancano.map((n) => [{ text: "✅ " + corto(n.p.nome), callback_data: `g|${oggi}|${n.id}|f` }, { text: "💧 Era umida", callback_data: `g|${oggi}|${n.id}|u` }, { text: "⏭ Salto", callback_data: `g|${oggi}|${n.id}|s` }]) } });
    }
    // 2. avvisi per domani
    const domani = met.days.find((d) => d.date === M.addDays(oggi, 1));
    const avv = M.avvisiDomani(fresco.plants, domani, met.notte);
    if (avv.length) { const ic = { gelo: "🥶", caldo: "🔥", vento: "💨" }; await invia("🌙 <b>Per domani</b>\n" + avv.map((a) => `${ic[a.tipo]} ${esc(a.testo)}`).join("\n")); }
    // 3. la domenica, il riepilogo della settimana
    if (new Date(oggi + "T12:00:00Z").getUTCDay() === 0) await invia(riepilogoSettimana(fresco, oggi));
    // 4. una volta al mese, il backup
    if ((t.ultimo_backup || "").slice(0, 7) !== oggi.slice(0, 7)) {
      try { await inviaFile(t.token, t.chat_id, `giardino-backup-${oggi}.json`, JSON.stringify(backup(fresco), null, 2), "🗂 Backup mensile del Giardino: in caso di bisogno importalo dall'app (Impostazioni → Backup)."); next.ultimo_backup = oggi; }
      catch (e) { console.error("backup", e?.message); }
    }
    next.ultimo_avviso_sera = oggi;
  }
  await st.setJSON(tkey, next);
}
