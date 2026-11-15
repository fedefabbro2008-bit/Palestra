import { store, leggi, aggiorna, tg, meteo, oraLocale, pianoAttivo, pianiOrti, pianoUnito, messaggioMattina, messaggioSettimana, segnaFatte, trovaZonaOPianta, pulsantiAcqua, esc, TIPI, ETICHETTE, ESITI, COMANDI, M } from "../lib/core.mjs";

/* Giardino · webhook di Telegram (/api/telegram/<segreto>).
   - /start dalla chat dell'utente: collega il bot a quella chat (solo la prima volta).
   - /oggi: manda subito il piano di oggi. /fatto [zona]: segna come annaffiate le piante di oggi. /settimana: i prossimi 7 giorni.
   - /vacanza 10/8 20/8 (o /vacanza no). /aiuto: l'elenco dei comandi.
   - pulsanti dei messaggi (Annaffiato, Terreno ancora umido, Salto, Era secca, Concimata): registrati nel diario all'istante;
     dopo la conferma resta «↩️ Annulla», che toglie la risposta e rimette i pulsanti di prima. */
export const config = { path: "/api/telegram/*" };
const ok = () => new Response("ok");
const corto = (s) => { s = String(s || ""); return s.length > 18 ? s.slice(0, 17) + "…" : s; };

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = new URL(request.url).pathname.split("/").pop();
  if (!/^[A-Z2-7]{32}$/.test(secret) || request.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("Forbidden", { status: 403 });
  const st = store();
  const w = await st.get("w-" + secret, { type: "json" });
  if (!w?.code) return new Response("Forbidden", { status: 403 });
  const tkey = "t-" + w.code, t = await st.get(tkey, { type: "json" });
  if (!t || t.secret !== secret) return new Response("Forbidden", { status: 403 });
  const u = await request.json().catch(() => null);
  try {
    if (u?.message) await messaggio(st, tkey, t, w.code, u.message);
    else if (u?.callback_query) await pulsante(st, t, w.code, u.callback_query);
  } catch (e) { console.error(e); }
  return ok();
};

async function messaggio(st, tkey, t, code, m) {
  const chat = m.chat?.id, testo = String(m.text || "").trim().toLowerCase();
  if (!chat || m.chat?.type !== "private") return;
  if (!t.chat_id) {
    if (!testo.startsWith("/start")) return;
    await st.setJSON(tkey, { ...t, chat_id: chat });
    await tg(t.token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: "✅ <b>Collegato a Giardino.</b>\nOgni mattina ti scrivo se c'è da innaffiare, controllare o concimare. La sera ti ricordo quello che manca e ti avviso se domani arrivano gelo, caldo o vento; la domenica ti mando il riepilogo e una volta al mese il backup.\n\nScrivi /oggi per vedere subito il piano, /aiuto per tutti i comandi." });
    return;
  }
  if (chat !== t.chat_id) { await tg(t.token, "sendMessage", { chat_id: chat, text: "Questo bot è già collegato a un'altra chat." }, { ignora: true }); return; }
  const comando = testo.split(/\s+/)[0].replace(/@.*$/, "");
  const invia = (text, extra = {}) => tg(t.token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  if (["/oggi", "oggi", "/fatto", "fatto", "/settimana", "settimana"].includes(comando)) {
    const cur = await leggi(st, code);
    if (!M.vistePiene(cur?.data || {}).length) { await invia("Aggiungi la posizione e le piante nell'app Giardino."); return; }
    // ogni orto con il suo meteo: un messaggio per orto
    const lista = await pianiOrti(cur.data), oggi = lista[0].oggi, ap = pianoUnito(lista);
    if (comando.endsWith("oggi")) {
      for (const x of lista) { const { msg, tastiera } = messaggioMattina(x.v, x.ap, oggi, { prova: true });
        await invia(msg, tastiera.length ? { reply_markup: { inline_keyboard: tastiera } } : {}); }
    } else if (comando.endsWith("settimana")) { for (const x of lista) await invia(messaggioSettimana(x.v, x.ap)); }
    else {
      // /fatto balcone → solo la zona «Balcone»; /fatto aglio → solo l'aglio, anche se oggi non era in programma
      const arg = String(m.text || "").trim().split(/\s+/).slice(1).join(" ").slice(0, 40), chi = trovaZonaOPianta(cur.data.plants, arg);
      if (chi.nessuno) { await invia(`Non trovo «${esc(arg)}» tra le zone e le piante. Scrivi /fatto da solo per tutte quelle di oggi.`); return; }
      const fatte = await segnaFatte(st, code, ap, oggi, { zona: chi.zona || "", pianta: chi.pianta || "", fonte: "telegram" });
      await invia(fatte.length ? "✅ Segnate come annaffiate: " + fatte.map(esc).join(", ") + "." : chi.pianta ? `${esc(chi.nome)} è già segnata per oggi.` : "Oggi non c'era niente da innaffiare" + (chi.zona ? " in " + esc(chi.zona) : "") + ", o l'avevi già segnato.");
    }
    return;
  }
  if (comando === "/vacanza") {
    const arg = testo.slice(8).trim();
    if (/^(no|annulla|off|stop)$/.test(arg)) { await aggiorna(st, code, (d) => { d.vacanza = null; }); await invia("🏡 Vacanza annullata."); return; }
    const date = [...arg.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/g)].map((m) => leggiData(m)).filter(Boolean);
    if (date.length !== 2 || date[1] <= date[0]) { await invia("Scrivi le date di partenza e di rientro, per esempio: <code>/vacanza 10/8 20/8</code>. Per annullare: <code>/vacanza no</code>."); return; }
    await aggiorna(st, code, (d) => { d.vacanza = { dal: date[0], al: date[1] }; });
    await invia(`🧳 Vacanza salvata: parti il ${fmtD(date[0])}, torni il ${fmtD(date[1])}. Il giorno prima ti ricordo di bagnare a fondo; nell'app vedi quanto resiste ogni pianta.`);
    return;
  }
  if (comando === "/aiuto" || comando === "/help") { await invia("<b>Comandi</b>\n" + COMANDI.map((c) => "/" + c.command + " — " + c.description).join("\n") + "\n\nPer domande sulle piante o una foto da valutare, scrivi a Claude: ha il connettore Giardino."); return; }
  if (testo.startsWith("/start")) { await tg(t.token, "sendMessage", { chat_id: chat, text: "Sei già collegato. Scrivi /oggi per il piano di oggi." }); return; }
  await tg(t.token, "sendMessage", { chat_id: chat, text: "Scrivi /aiuto per i comandi. Per domande sulle piante chiedi a Claude: ha il connettore Giardino." }, { ignora: true });
}
const fmtD = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "long" });
function leggiData(m) {
  const z = (n) => String(n).padStart(2, "0"), oggi = M.isoDate(new Date());
  let y, mo, d;
  if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else { d = +m[4]; mo = +m[5]; y = m[6] ? (+m[6] < 100 ? 2000 + +m[6] : +m[6]) : +oggi.slice(0, 4); }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let iso = `${y}-${z(mo)}-${z(d)}`;
  if (!m[1] && !m[6] && iso < M.addDays(oggi, -1)) iso = `${y + 1}-${z(mo)}-${z(d)}`;   // date senza anno già passate: l'anno prossimo
  return iso;
}

const BREVE = { fatto: "annaffiata", saltato: "saltata", umido: "umida", secco: "secca, annaffiata", concime: "concimata" };
// Pulsante «Annulla»: callback g|data|pianta|z + com'erano i pulsanti (c = concime, a = era secca, s = con Salto, n = senza Salto)
const annullaCb = (data, pid, v) => `g|${data}|${pid}|z${v}`;

async function pulsante(st, t, code, cq) {
  // la conferma non blocca mai il resto (parte insieme ai pulsanti nuovi): se Telegram non risponde resta solo nel registro
  const rispondi = (text) => tg(t.token, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) }, { ignora: true }).catch((e) => { console.warn("Telegram answerCallbackQuery:", e?.message); return null; });
  if (cq.message?.chat?.id !== t.chat_id) return rispondi();
  const [k, data, pid, x] = String(cq.data || "").split("|");
  if (k === "v" && /^[us]$/.test(x || "") && /^\d{4}-\d{2}-\d{2}$/.test(data || "")) return verifica(st, t, code, cq, rispondi);
  if (k === "g" && /^z[casn]$/.test(x || "") && /^\d{4}-\d{2}-\d{2}$/.test(data || "")) return annulla(st, t, code, cq, data, pid, x[1], rispondi);
  const tipo = TIPI[x];
  if (k !== "g" || !tipo || !/^\d{4}-\d{2}-\d{2}$/.test(data || "")) return rispondi("Già registrato");
  let nome = pid;
  await aggiorna(st, code, (d) => {
    const p = d.plants.find((y) => y.id === pid); if (!p) return false;
    nome = p.nome;
    if (d.eventi.some((e) => e.plantId === pid && e.data === data && e.tipo === tipo && e.fonte === "telegram")) return false;
    if (tipo !== "concime") d.eventi = d.eventi.filter((e) => !(e.plantId === pid && e.data === data && e.fonte === "telegram" && ESITI.includes(e.tipo)));
    const g = d.piano_claude?.data?.piante?.find((y) => y.id === pid)?.giorni?.find((y) => y.data === data);
    d.eventi.push({ id: "tg-" + cq.id, plantId: pid, tipo, data, fonte: "telegram", ts: new Date().toISOString(), ...(tipo === "fatto" || tipo === "secco" ? { litri: g?.litri ?? (t.notificati?.[data] || []).find((n) => n.id === pid)?.litri ?? null } : {}) });
  });
  // la conferma e i pulsanti nuovi partono insieme (prima una richiesta a Telegram dopo l'altra: il doppio dell'attesa)
  const conferma = rispondi(`Registrato: ${nome} — ${ETICHETTE[tipo]}`);
  const kb = cq.message?.reply_markup?.inline_keyboard;
  if (kb) {
    // le righe della pianta premuta (Annaffiato + Terreno ancora umido/Salto, oppure Concimata) diventano una sola riga:
    // la conferma e «↩️ Annulla»
    const gruppo = x === "c" ? "c" : "w", cbs = kb.flat().map((b) => b.callback_data || "").filter((c) => c.startsWith(`g|${data}|${pid}|`));
    const v = gruppo === "c" ? "c" : cbs.some((c) => c.endsWith("|a")) ? "a" : cbs.some((c) => c.endsWith("|s")) ? "s" : "n";
    let messa = false;
    const nuova = kb.map((row) => {
      const cb = row.map((b) => b.callback_data || "");
      const stessa = cb.some((c) => c.startsWith(`g|${data}|${pid}|`)), suo = cb.some((c) => /\|z?c$/.test(c)) ? "c" : "w";
      if (!(stessa && suo === gruppo)) return row;
      if (messa) return null;
      messa = true; return [{ text: `✔ ${corto(nome)}: ${BREVE[tipo]}`, callback_data: "x" }, { text: "↩️ Annulla", callback_data: annullaCb(data, pid, v) }];
    }).filter(Boolean);
    await tg(t.token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: nuova } }, { ignora: true });
  }
  await conferma;
}

// Controllo della settimana: «umido» o «asciutto» confrontato con l'acqua che il calcolo dava nel terriccio.
async function verifica(st, t, code, cq, rispondi) {
  const [, data, pid, x, a, sg, as, ora] = String(cq.data).split("|"), risposta = x === "u" ? "umido" : "secco";
  const acqua = +a >= 0 ? +a / 100 : null, soglia = +sg >= 0 ? +sg / 100 : null, acquaSecco = as != null && +as >= 0 ? +as / 100 : null, v = M.esitoVerifica(risposta, acqua, soglia, acquaSecco);
  let nome = pid, gia = false;
  await aggiorna(st, code, (d) => {
    const p = d.plants.find((y) => y.id === pid); if (!p) return false; nome = p.nome;
    if (d.eventi.some((e) => e.plantId === pid && e.data === data && e.tipo === "verifica")) { gia = true; return false; }
    d.eventi.push({ id: "tg-" + cq.id, plantId: pid, tipo: "verifica", data, fonte: "telegram", ts: new Date().toISOString(), esito: risposta, valutazione: v, acqua });
  });
  const conferma = rispondi(gia ? "Già registrato" : risposta === "secco" ? M.testoSecco(v, acqua, soglia, acquaSecco, ora == null ? undefined : ora === "1") : M.TESTO_VERIFICA[v]);
  if (!gia) await tg(t.token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[{ text: `✔ ${corto(nome)}: ${risposta} — ${v === "ok" ? (risposta === "secco" ? "normale, calcolo giusto" : "calcolo giusto") : v === "piu" ? "beve di più" : "beve di meno"}`, callback_data: "x" }]] } }, { ignora: true });
  await conferma;
}

// Annulla: toglie la risposta data da Telegram per quella pianta e quel giorno e rimette i pulsanti com'erano.
async function annulla(st, t, code, cq, data, pid, v, rispondi) {
  let p = null, tolte = 0;
  await aggiorna(st, code, (d) => {
    p = d.plants.find((y) => y.id === pid) || null; if (!p) return false;
    const prima = d.eventi.length;
    d.eventi = d.eventi.filter((e) => !(e.plantId === pid && e.data === data && e.fonte === "telegram" && (v === "c" ? e.tipo === "concime" : ESITI.includes(e.tipo))));
    tolte = prima - d.eventi.length;
    if (!tolte) return false;
  });
  if (!p) return rispondi("Pianta non trovata");
  const conferma = rispondi(tolte ? `Annullato: ${p.nome}` : "Niente da annullare");
  const kb = cq.message?.reply_markup?.inline_keyboard;
  if (!kb) return conferma;
  const altre = kb.flat().some((b) => /^g\|/.test(b.callback_data || "") && !(b.callback_data || "").startsWith(`g|${data}|${pid}|`));
  const righe = v === "c" ? [[{ text: "🌱 " + corto(p.nome) + " concimata", callback_data: `g|${data}|${pid}|c` }]]
    : pulsantiAcqua(p, data, { conNome: altre, salto: v === "s", secca: v === "a" });
  const nuova = kb.flatMap((row) => row.some((b) => b.callback_data === cq.data) ? righe : [row]);
  await tg(t.token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: nuova } }, { ignora: true });
  await conferma;
}
