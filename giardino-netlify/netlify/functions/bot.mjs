import { store, leggi, aggiorna, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, presunti, riepilogoSettimana, backup, inviaFile, pulsantiAcqua, doseControllo, finePiano, messaggioFinePiano, notaPioggia, aggiornaPioggiaMisurata, rinnovaPioggia, esc, IMP_DEF, ESITI, notifica, M } from "../lib/core.mjs";
import { avvisiTorre } from "../lib/torre.mjs";

/* Giardino · bot pianificato, ogni ora (funzione pianificata di Netlify).
   Ogni notifica alla sua ora (Impostazioni → Notifiche, impostazioni.orari; senza, il mattino o la sera di prima).
   Per ogni bot Telegram collegato, all'ora locale:
   - mattino (default dalle 7): una volta al giorno il piano, solo se c'è qualcosa da fare;
   - sera (default dalle 19), una volta al giorno:
       · promemoria delle piante da innaffiare oggi ancora senza risposta;
       · le piante da controllare col dito oggi (dal piano della sera) ancora senza risposta;
       · avvisi per domani (gelo con le temperature ora per ora della notte, caldo, vento e raffiche, temporale, grandine);
       · la domenica, il riepilogo della settimana;
       · il primo giorno utile di ogni mese, il file di backup;
       · se il piano di Claude finisce domani (o è già finito), una volta per piano, l'invito ad aggiornarlo;
   - le innaffiature notificate e rimaste senza risposta, il giorno dopo, si considerano fatte. */
export const config = { schedule: "@hourly" };

export default async () => {
  const st = store();
  const { blobs } = await st.list({ prefix: "t-" });
  // ogni 3 ore: pioggia misurata dalle stazioni ARPAE (solo per le posizioni in Emilia-Romagna)
  if (new Date().getUTCHours() % 3 === 0) { try { await aggiornaPioggiaMisurata(st); } catch (e) { console.error("pioggia misurata", e?.message); } }
  for (const b of blobs) { try { await uno(st, b.key); } catch (e) { console.error(b.key, e?.message || e); } }
  return new Response("ok");
};


// Notifiche già fatte oggi (inviate, spente o saltate perché è passata l'ora): t.inviati_il = {tipo: giorno}.
// Con i dati di prima (solo ultimo_invio / ultimo_avviso_sera) valgono quelli, per non rimandare i messaggi il giorno del passaggio.
function fattiOggi(t, oggi) {
  const f = new Set(Object.entries(t.inviati_il || {}).filter(([, g]) => g === oggi).map(([k]) => k));
  if (!t.inviati_il) { if (t.ultimo_invio === oggi) M.NOTIFICHE_MATTINO.forEach((k) => f.add(k)); if (t.ultimo_avviso_sera === oggi) M.NOTIFICHE_CON_ORA.filter((k) => !M.NOTIFICHE_MATTINO.includes(k)).forEach((k) => f.add(k)); }
  return f;
}

async function uno(st, tkey) {
  const f = await st.getWithMetadata(tkey, { type: "json" }), t = f?.data;
  if (!t?.chat_id) return;
  // tutte le notifiche di oggi già fatte: niente da leggere né da calcolare fino a domani
  { const { oggi: g } = oraLocale(t.tz || "Europe/Rome"), fatti = fattiOggi(t, g); if (M.NOTIFICHE_CON_ORA.every((k) => fatti.has(k))) return; }
  const code = tkey.slice(2);
  const cur = await leggi(st, code);
  if (!M.vistePiene(cur?.data || {}).length) return;   // nessun orto con posizione e piante
  const imp = { ...IMP_DEF, ...(cur.data.impostazioni || {}) }, on = (tipo) => notifica(imp, tipo);   // notifiche spente in Impostazioni
  const { oggi, ora } = oraLocale(t.tz || "Europe/Rome");
  // ogni notifica alla sua ora (Impostazioni → Notifiche): dovute = da fare adesso; passate = ora finita senza giro del bot
  const fatti = fattiOggi(t, oggi), dovute = new Set(), passate = [];
  for (const k of M.NOTIFICHE_CON_ORA) {
    if (fatti.has(k) || ora < M.oraNotifica(imp, k)) continue;
    if (ora < M.fineNotifica(imp, k)) dovute.add(k); else passate.push(k);
  }
  if (!dovute.size && !passate.length) return;
  // prenotazione: segno le notifiche come fatte prima di inviare, solo se nessun altro giro del bot l'ha già fatto
  // (Netlify a volte avvia la funzione pianificata due volte nello stesso minuto: prima arrivavano due messaggi uguali)
  const segnate = {}; for (const [k, g] of Object.entries(t.inviati_il || {})) if (g === oggi) segnate[k] = g;
  for (const k of fatti) segnate[k] = oggi;
  for (const k of [...dovute, ...passate]) segnate[k] = oggi;
  const pren = { ...t, inviati_il: segnate, ...(segnate.mattina ? { ultimo_invio: oggi } : {}), ...(segnate.sera ? { ultimo_avviso_sera: oggi } : {}) };
  const ok = await st.setJSON(tkey, pren, f.etag ? { onlyIfMatch: f.etag } : {});
  if (ok && ok.modified === false) return;
  if (!dovute.size) return;

  try { await invii(st, tkey, pren, cur, code, imp, on, oggi, dovute); }
  catch (e) {
    // invio non riuscito: tolgo la prenotazione delle notifiche di questo giro, così ci riprova il giro dell'ora dopo
    const g = await st.getWithMetadata(tkey, { type: "json" }).catch(() => null);
    if (g?.data) {
      const il = { ...(g.data.inviati_il || {}) }; for (const k of dovute) { if (t.inviati_il?.[k] != null) il[k] = t.inviati_il[k]; else delete il[k]; }
      await st.setJSON(tkey, { ...g.data, inviati_il: il, ...(dovute.has("mattina") ? { ultimo_invio: t.ultimo_invio ?? null } : {}), ...(dovute.has("sera") ? { ultimo_avviso_sera: t.ultimo_avviso_sera ?? null } : {}) }, { onlyIfMatch: g.etag }).catch(() => {});
    }
    throw e;
  }
}

async function invii(st, tkey, t, cur, code, imp, on, oggi, dovute) {
  // ogni orto (città) con il suo meteo e il suo piano; meteo e piano solo se servono a una notifica accesa
  const next = { ...t }, fa = (k) => dovute.has(k) && on(k);
  const invia = (text, extra = {}) => tg(t.token, "sendMessage", { chat_id: t.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  let data = cur.data;
  const memo = new Map();
  const vista = (o) => M.vistaOrto(data, o.id);
  const meteoDi = async (v) => { const k = v.orto.id; if (!memo.has(k)) memo.set(k, { met: await meteo(v.location.lat, v.location.lon) }); return memo.get(k).met; };
  const pianoDi = async (v) => { const met = await meteoDi(v), m = memo.get(v.orto.id); return (m.ap ||= pianoAttivo(v, met, oggi)); };
  const orti = () => M.orti(data).filter((o) => { const v = vista(o); return v.location && v.plants.length; });
  const titolo = (v, testo) => (v.piuOrti ? `<b>${esc(M.nomeOrto(v.orto))}</b> · ` : "") + testo;

  // il primo giro del giorno: innaffiature notificate ieri e rimaste senza risposta (date per fatte), pioggia di tutta la vita
  if (t.lavori_il !== oggi) {
    const pres = presunti(t, data, oggi);
    if (pres.length) data = (await aggiorna(st, code, (d) => { for (const e of pres) if (!d.eventi.some((x) => x.id === e.id)) d.eventi.push(e); })).data;
    // acqua di tutta la vita: la pioggia che sta per uscire dall'archivio del meteo resta contata (di rado: ogni ~50 giorni)
    try { data = await rinnovaPioggia(st, code, data, oggi, meteoDi); } catch (e) { console.warn("pioggia di tutta la vita:", e?.message); }
    next.notificati = Object.fromEntries(Object.entries(t.notificati || {}).filter(([d]) => d >= oggi));
    next.lavori_il = oggi;
  }

  // le piante da innaffiare oggi: servono al piano del mattino e al promemoria della sera (anche se il mattino è spento),
  // si segnano una volta al giorno, alla prima delle due che arriva
  const segnare = next.segnati_il !== oggi && (dovute.has("mattina") || dovute.has("sera")) && (on("mattina") || on("sera"));
  if (fa("mattina") || segnare || fa("verifica")) {
    const oggiN = [];
    const sabato = new Date(oggi + "T12:00:00Z").getUTCDay() === 6 && t.ultima_verifica !== oggi;
    for (const o of orti()) {
      const v = vista(o);
      if (fa("mattina") || segnare) {
        const p = await pianoDi(v), { msg, tastiera, daFare } = messaggioMattina(v, p, oggi);
        if (daFare) {
          if (fa("mattina")) await invia(msg, tastiera.length ? { reply_markup: { inline_keyboard: tastiera } } : {});
          if (segnare) oggiN.push(...v.plants.map((x) => ({ id: x.id, g: p.piano.piante.find((y) => y.id === x.id)?.giorni?.find((g) => g.data === oggi) }))
            .filter((x) => x.g?.azione === "innaffia").map((x) => ({ id: x.id, litri: x.g.litri })));
        }
      }
      // il sabato, il controllo della settimana: una pianta da toccare con il dito (una per orto)
      const pv = fa("verifica") && sabato ? M.verificaDaFare(v.plants, v.eventi, oggi, v.vacanza) : null;
      if (pv) {
        const pb = (await pianoDi(v)).base.piante.find((x) => x.id === pv.id), a = Math.round((pb?.acqua ?? -1) * 100), sg = Math.round((pb?.soglia ?? -1) * 100), as = Math.round((pb?.acquaSecco ?? -1) * 100), ora = pb?.seccoOra ? 1 : 0;
        const cb = (r) => `v|${oggi}|${pv.id}|${r}|${a}|${sg}|${as}|${ora}`;
        await invia(titolo(v, `🔍 <b>Controllo della settimana</b>\n<b>${esc(pv.nome)}</b>: ${esc(M.testoDito(M.profonditaDito(v.plants.find((x) => x.id === pv.id) || pv, oggi, v.location?.lat)))}: com'è?\n<i>Così l'app impara quanto beve davvero.</i>`),
          { reply_markup: { inline_keyboard: [[{ text: "💦 Umido", callback_data: cb("u") }, { text: "🏜 Asciutto", callback_data: cb("s") }]] } });
        next.ultima_verifica = oggi;
      }
    }
    if (segnare) { next.notificati = { ...(next.notificati || {}) }; if (oggiN.length) next.notificati[oggi] = oggiN; next.segnati_il = oggi; }
  }

  const SERALI = ["sera", "controllo", "avvisi", "riepilogo", "backup", "piano", "torre"];
  if (SERALI.some(fa)) {
    data = (await leggi(st, code))?.data || data;
    for (const o of orti()) {
      const v = vista(o);
      // 1. promemoria: piante da innaffiare oggi ancora senza risposta (né dall'app, né da Telegram, né da Claude)
      const mancano = !fa("sera") ? [] : (next.notificati?.[oggi] || []).filter((n) => !v.eventi.some((e) => e.plantId === n.id && e.data === oggi && ESITI.includes(e.tipo)))
        .map((n) => ({ ...n, p: v.plants.find((p) => p.id === n.id) })).filter((n) => n.p)
        .sort((a, b) => a.p.nome.localeCompare(b.p.nome, "it", { sensitivity: "base" }));
      if (mancano.length && !M.inVacanza(v.vacanza, oggi)) {
        const m = await meteoDi(v), d0 = m.days.find((d) => d.date === oggi);
        await invia(titolo(v, "🔔 <b>Ancora da innaffiare oggi</b>\n") + mancano.map((n) => { const np = notaPioggia(n.p, d0); return `💧 ${esc(n.p.nome)}: ${String(n.litri).replace(".", ",")} L (${esc(M.dose(n.litri, imp))})${np ? " <i>(" + esc(np) + ")</i>" : ""}`; }).join("\n") + "\n<i>Premi Annaffiato oppure Terreno ancora umido. Se non premi nulla, domani la conto come annaffiata.</i>",
          { reply_markup: { inline_keyboard: mancano.flatMap((n) => pulsantiAcqua(n.p, oggi, { conNome: mancano.length > 1, salto: false, litri: n.litri })) } });
      }
      // 2. controlli col dito: le piante che il piano di adesso dice di controllare oggi, ancora senza risposta.
      //    Dal piano di adesso, mai in notificati: lì domani diventerebbero innaffiature presunte.
      if (fa("controllo") && !M.inVacanza(v.vacanza, oggi)) {
        const pa = await pianoDi(v), lat = v.location?.lat, giaSera = new Set((next.notificati?.[oggi] || []).map((n) => n.id));
        const ctrl = M.pianteOrdinate(v.plants).filter((x) => !giaSera.has(x.id)
          && pa.piano.piante.find((y) => y.id === x.id)?.giorni?.find((g) => g.data === oggi)?.azione === "controlla"
          && !v.eventi.some((e) => e.plantId === x.id && e.data === oggi && (ESITI.includes(e.tipo) || e.tipo === "verifica")));
        if (ctrl.length) await invia(titolo(v, "👆 <b>Da controllare oggi</b>\n") + ctrl.map((x) => { const l = doseControllo(x, oggi, lat);
          return `${esc(String(x.emoji || (M.SPECIE[x.specie] || M.SPECIE.altro).ico).slice(0, 8))} <b>${esc(x.nome)}</b>: ${esc(M.testoDito(M.profonditaDito(x, oggi, lat)))}. Se è asciutto, innaffia: ${String(l).replace(".", ",")} L (${esc(M.dose(l, imp))})`; }).join("\n")
          + "\n<i>Premi com'era la terra: così l'app impara quanto beve.</i>",
          { reply_markup: { inline_keyboard: ctrl.flatMap((x) => pulsantiAcqua(x, oggi, { conNome: ctrl.length > 1, salto: false, secca: true })) } });
      }
      // 3. avvisi per domani
      if (fa("avvisi")) {
        const m = await meteoDi(v), avv = M.avvisiDomani(v.plants, m.days.find((d) => d.date === M.addDays(oggi, 1)), m.notte);
        if (avv.length) { const ic = { gelo: "🥶", caldo: "🔥", vento: "💨", temporale: "⛈", grandine: "🧊" }; await invia(titolo(v, "🌙 <b>Per domani</b>\n") + avv.map((a) => `${ic[a.tipo]} ${esc(a.testo)}`).join("\n")); }
      }
      // 4. la domenica, il riepilogo della settimana (uno per orto)
      if (fa("riepilogo") && new Date(oggi + "T12:00:00Z").getUTCDay() === 0) await invia(riepilogoSettimana(v, oggi, await meteoDi(v)));
    }
    // 5. una volta al mese, il backup (tutti gli orti insieme)
    if (fa("backup") && (t.ultimo_backup || "").slice(0, 7) !== oggi.slice(0, 7)) {
      try { await inviaFile(t.token, t.chat_id, `giardino-backup-${oggi}.json`, JSON.stringify(backup(data), null, 2), "🗂 Backup mensile del Giardino: in caso di bisogno importalo dall'app (Impostazioni → Backup)."); next.ultimo_backup = oggi; }
      catch (e) { console.error("backup", e?.message); }
    }
    // 6. il piano di Claude sta per finire: lo dico una volta per piano, il giorno prima dell'ultimo (o appena me ne accorgo)
    const pc = data.piano_claude, fine = finePiano(pc), idPiano = pc?.createdAt || fine;
    if (fa("piano") && fine && fine <= M.addDays(oggi, 1) && t.avviso_piano !== idPiano) {
      const m = messaggioFinePiano(fine, oggi);
      await invia(m.testo, { reply_markup: m.tastiera });
      next.avviso_piano = idPiano;
    }
    // 7. torre idroponica (solo se attiva): silenzio, gelo e pioggia previsti dove si trova, freddo misurato
    const torre = data.torre;
    if (fa("torre") && torre && torre.attiva !== false) {
      try {
        const v = M.vistaOrto(data, torre.orto || "p"), met = v.location ? await meteoDi(v) : null, serie = await st.get("s-" + code, { type: "json" });
        const avv = avvisiTorre(torre, serie, met, oggi, Math.floor(Date.now() / 1000), met?.tz || t.tz || "Europe/Rome");
        if (avv.length) await invia(`🌱 <b>${esc(torre.nome || "Torre idroponica")}</b>\n` + avv.map((a) => esc(a.testo)).join("\n"));
      } catch (e) { console.warn("torre:", e?.message); }
    }
  }
  const primo = memo.get("p")?.met || [...memo.values()][0]?.met;
  if (primo?.tz) next.tz = primo.tz;
  await st.setJSON(tkey, next);
  return;
}
