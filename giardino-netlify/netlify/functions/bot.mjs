import { store, leggi, aggiorna, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, presunti, riepilogoSettimana, backup, inviaFile, pulsantiAcqua, finePiano, messaggioFinePiano, crediti, segnaAvvisoCrediti, notaPioggia, aggiornaPioggiaMisurata, esc, IMP_DEF, ESITI, notifica, M } from "../lib/core.mjs";

/* Giardino · bot pianificato, ogni ora (funzione pianificata di Netlify).
   Per ogni bot Telegram collegato, all'ora locale:
   - mattino (default dalle 7): una volta al giorno il piano, solo se c'è qualcosa da fare;
   - sera (default dalle 19), una volta al giorno:
       · promemoria delle piante da innaffiare oggi ancora senza risposta;
       · avvisi per domani (gelo con le temperature ora per ora della notte, caldo, vento e raffiche, temporale, grandine);
       · la domenica, il riepilogo della settimana;
       · il primo giorno utile di ogni mese, il file di backup;
       · se il piano di Claude finisce domani (o è già finito), una volta per piano, l'invito ad aggiornarlo;
   - le innaffiature notificate e rimaste senza risposta, il giorno dopo, si considerano fatte. */
export const config = { schedule: "@hourly" };

export default async () => {
  const st = store();
  // crediti Netlify: conta la versione pubblicata; sopra l'80% della stima avvisa una volta al mese
  let cr = null; try { cr = await crediti(st); } catch (e) { console.error("crediti", e?.message); }
  // ogni 3 ore: pioggia misurata dalle stazioni ARPAE (solo per le posizioni in Emilia-Romagna)
  if (new Date().getUTCHours() % 3 === 0) { try { await aggiornaPioggiaMisurata(st); } catch (e) { console.error("pioggia misurata", e?.message); } }
  const { blobs } = await st.list({ prefix: "t-" });
  let avvisati = 0;
  for (const b of blobs) {
    try { if (await uno(st, b.key, cr && cr.alto && !cr.avvisato ? cr : null)) avvisati++; } catch (e) { console.error(b.key, e?.message || e); }
  }
  if (avvisati) await segnaAvvisoCrediti(st, cr);
  return new Response("ok");
};


async function uno(st, tkey, cr) {
  const t = await st.get(tkey, { type: "json" });
  if (!t?.chat_id) return;
  // oggi mattino e sera già fatti (e niente avviso dei crediti): niente da leggere né da calcolare fino a domani
  if (!cr) { const { oggi: g } = oraLocale(t.tz || "Europe/Rome"); if (t.ultimo_invio === g && t.ultimo_avviso_sera === g) return; }
  const code = tkey.slice(2);
  const cur = await leggi(st, code);
  if (!cur?.data?.location || !cur.data.plants.length) return;
  const imp = { ...IMP_DEF, ...(cur.data.impostazioni || {}) }, on = (tipo) => notifica(imp, tipo);   // notifiche spente in Impostazioni
  const { oggi, ora } = oraLocale(t.tz || "Europe/Rome");
  const mattina = ora >= +imp.ora_mattina && ora < 21 && t.ultimo_invio !== oggi;
  const sera = ora >= +imp.ora_sera && ora < 23 && t.ultimo_avviso_sera !== oggi;
  let avvisoCrediti = false;
  if (cr && t.chat_id) {
    if (on("crediti")) await tg(t.token, "sendMessage", { chat_id: t.chat_id, parse_mode: "HTML", text: `📊 <b>Crediti Netlify</b>: stima ${cr.stima} su ${cr.limite} questo mese (${cr.pubblicazioni} pubblicazioni da 15 crediti).\nSe finiscono il sito va in pausa fino al mese prossimo: rimanda gli aggiornamenti dell'app. Il conto esatto è su app.netlify.com → Usage.` }, { ignora: true });
    avvisoCrediti = true;   // inviato, o spento: per questo mese non si ripropone
  }
  if (!mattina && !sera) return avvisoCrediti;

  // meteo e piano solo se servono a una notifica accesa
  let met = null, ap = null;
  const meteoOra = async () => (met ||= await meteo(cur.data.location.lat, cur.data.location.lon));
  const next = { ...t };
  const invia = (text, extra = {}) => tg(t.token, "sendMessage", { chat_id: t.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  let data = cur.data;
  const pianoOra = async () => (ap ||= pianoAttivo(data, await meteoOra(), oggi));

  if (mattina) {
    const pres = presunti(t, data, oggi);
    if (pres.length) data = (await aggiorna(st, code, (d) => { for (const e of pres) if (!d.eventi.some((x) => x.id === e.id)) d.eventi.push(e); })).data;
    next.notificati = Object.fromEntries(Object.entries(t.notificati || {}).filter(([d]) => d >= oggi));
    // le piante di oggi servono al messaggio del mattino e al promemoria della sera (anche se il mattino è spento)
    if (on("mattina") || on("sera")) {
      const p = await pianoOra(), { msg, tastiera, daFare } = messaggioMattina(data, p, oggi);
      if (daFare) {
        if (on("mattina")) await invia(msg, tastiera.length ? { reply_markup: { inline_keyboard: tastiera } } : {});
        next.notificati[oggi] = data.plants.map((x) => ({ id: x.id, g: p.piano.piante.find((y) => y.id === x.id)?.giorni?.find((g) => g.data === oggi) }))
          .filter((x) => x.g?.azione === "innaffia").map((x) => ({ id: x.id, litri: x.g.litri }));
      }
    }
    // il sabato, il controllo della settimana: una pianta da toccare con il dito
    const pv = on("verifica") && new Date(oggi + "T12:00:00Z").getUTCDay() === 6 && t.ultima_verifica !== oggi ? M.verificaDaFare(data.plants, data.eventi, oggi, data.vacanza) : null;
    if (pv) {
      const pb = (await pianoOra()).base.piante.find((x) => x.id === pv.id), a = Math.round((pb?.acqua ?? -1) * 100), sg = Math.round((pb?.soglia ?? -1) * 100);
      const cb = (r) => `v|${oggi}|${pv.id}|${r}|${a}|${sg}`;
      await invia(`🔍 <b>Controllo della settimana</b>\n<b>${esc(pv.nome)}</b>: ${esc(M.testoDito(M.profonditaDito(data.plants.find((x) => x.id === pv.id) || pv, oggi, cur.data.location?.lat)))}: com'è?\n<i>Così l'app impara quanto beve davvero.</i>`,
        { reply_markup: { inline_keyboard: [[{ text: "💦 Umido", callback_data: cb("u") }, { text: "🏜 Asciutto", callback_data: cb("s") }]] } });
      next.ultima_verifica = oggi;
    }
    next.ultimo_invio = oggi;
  }

  if (sera) {
    const fresco = (await leggi(st, code))?.data || data;
    // 1. promemoria: piante da innaffiare oggi ancora senza risposta (né dall'app, né da Telegram, né da Claude)
    const mancano = !on("sera") ? [] : (next.notificati?.[oggi] || []).filter((n) => !fresco.eventi.some((e) => e.plantId === n.id && e.data === oggi && ESITI.includes(e.tipo)))
      .map((n) => ({ ...n, p: fresco.plants.find((p) => p.id === n.id) })).filter((n) => n.p)
      .sort((a, b) => a.p.nome.localeCompare(b.p.nome, "it", { sensitivity: "base" }));
    if (mancano.length && !M.inVacanza(fresco.vacanza, oggi)) {
      const m = await meteoOra(), d0 = m.days.find((d) => d.date === oggi);
      await invia("🔔 <b>Ancora da innaffiare oggi</b>\n" + mancano.map((n) => { const np = notaPioggia(n.p, d0); return `💧 ${esc(n.p.nome)}: ${String(n.litri).replace(".", ",")} L (${esc(M.dose(n.litri, imp))})${np ? " <i>(" + esc(np) + ")</i>" : ""}`; }).join("\n") + "\n<i>Premi Annaffiato oppure Terreno ancora umido. Se non premi nulla, domani la conto come annaffiata.</i>",
        { reply_markup: { inline_keyboard: mancano.flatMap((n) => pulsantiAcqua(n.p, oggi, { conNome: mancano.length > 1, salto: false })) } });
    }
    // 2. avvisi per domani
    if (on("avvisi")) {
      const m = await meteoOra(), avv = M.avvisiDomani(fresco.plants, m.days.find((d) => d.date === M.addDays(oggi, 1)), m.notte);
      if (avv.length) { const ic = { gelo: "🥶", caldo: "🔥", vento: "💨", temporale: "⛈", grandine: "🧊" }; await invia("🌙 <b>Per domani</b>\n" + avv.map((a) => `${ic[a.tipo]} ${esc(a.testo)}`).join("\n")); }
    }
    // 3. la domenica, il riepilogo della settimana
    if (on("riepilogo") && new Date(oggi + "T12:00:00Z").getUTCDay() === 0) await invia(riepilogoSettimana(fresco, oggi, await meteoOra()));
    // 4. una volta al mese, il backup
    if (on("backup") && (t.ultimo_backup || "").slice(0, 7) !== oggi.slice(0, 7)) {
      try { await inviaFile(t.token, t.chat_id, `giardino-backup-${oggi}.json`, JSON.stringify(backup(fresco), null, 2), "🗂 Backup mensile del Giardino: in caso di bisogno importalo dall'app (Impostazioni → Backup)."); next.ultimo_backup = oggi; }
      catch (e) { console.error("backup", e?.message); }
    }
    // 5. il piano di Claude sta per finire: lo dico una volta per piano, la sera prima dell'ultimo giorno (o appena me ne accorgo)
    const pc = fresco.piano_claude, fine = finePiano(pc), idPiano = pc?.createdAt || fine;
    if (on("piano") && fine && fine <= M.addDays(oggi, 1) && t.avviso_piano !== idPiano) {
      const m = messaggioFinePiano(fine, oggi);
      await invia(m.testo, { reply_markup: m.tastiera });
      next.avviso_piano = idPiano;
    }
    next.ultimo_avviso_sera = oggi;
  }
  if (met?.tz) next.tz = met.tz;
  await st.setJSON(tkey, next);
  return avvisoCrediti;
}
