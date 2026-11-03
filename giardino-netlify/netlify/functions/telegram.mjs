import { store, leggi, aggiorna, tg, meteo, oraLocale, pianoAttivo, messaggioMattina, TIPI, ETICHETTE } from "../lib/core.mjs";

/* Giardino · webhook di Telegram (/api/telegram/<segreto>).
   - /start dalla chat dell'utente: collega il bot a quella chat (solo la prima volta).
   - /oggi: manda subito il piano di oggi.
   - pulsanti dei messaggi (Fatto, Era umida, Salto, Secca, Concimata): registrati nel diario all'istante. */
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
    await tg(t.token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: "✅ <b>Collegato a Giardino.</b>\nOgni mattina ti scrivo se c'è da innaffiare, controllare o concimare; la sera ti avviso se domani arrivano gelo, caldo o vento.\n\nScrivi /oggi per vedere subito il piano." });
    return;
  }
  if (chat !== t.chat_id) { await tg(t.token, "sendMessage", { chat_id: chat, text: "Questo bot è già collegato a un'altra chat." }, { ignora: true }); return; }
  if (testo.startsWith("/oggi") || testo === "oggi") {
    const cur = await leggi(st, code);
    if (!cur?.data?.location || !cur.data.plants.length) { await tg(t.token, "sendMessage", { chat_id: chat, text: "Aggiungi la posizione e le piante nell'app Giardino." }); return; }
    const met = await meteo(cur.data.location.lat, cur.data.location.lon), { oggi } = oraLocale(met.tz);
    const { msg, tastiera } = messaggioMattina(cur.data, pianoAttivo(cur.data, met, oggi), oggi, { prova: true });
    await tg(t.token, "sendMessage", { chat_id: chat, text: msg, parse_mode: "HTML", disable_web_page_preview: true, ...(tastiera.length ? { reply_markup: { inline_keyboard: tastiera } } : {}) });
    return;
  }
  if (testo.startsWith("/start")) { await tg(t.token, "sendMessage", { chat_id: chat, text: "Sei già collegato. Scrivi /oggi per il piano di oggi." }); return; }
  await tg(t.token, "sendMessage", { chat_id: chat, text: "Scrivi /oggi per il piano di oggi. Per domande sulle piante chiedi a Claude: ha il connettore Giardino." }, { ignora: true });
}

async function pulsante(st, t, code, cq) {
  const rispondi = (text) => tg(t.token, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) }, { ignora: true });
  if (cq.message?.chat?.id !== t.chat_id) return rispondi();
  const [k, data, pid, x] = String(cq.data || "").split("|"), tipo = TIPI[x];
  if (k !== "g" || !tipo || !/^\d{4}-\d{2}-\d{2}$/.test(data || "")) return rispondi("Già registrato");
  let nome = pid;
  await aggiorna(st, code, (d) => {
    const p = d.plants.find((y) => y.id === pid); if (!p) return false;
    nome = p.nome;
    if (d.eventi.some((e) => e.plantId === pid && e.data === data && e.tipo === tipo && e.fonte === "telegram")) return false;
    if (tipo !== "concime") d.eventi = d.eventi.filter((e) => !(e.plantId === pid && e.data === data && e.fonte === "telegram" && ["fatto", "secco", "umido", "saltato"].includes(e.tipo)));
    const g = d.piano_claude?.data?.piante?.find((y) => y.id === pid)?.giorni?.find((y) => y.data === data);
    d.eventi.push({ id: "tg-" + cq.id, plantId: pid, tipo, data, fonte: "telegram", ts: new Date().toISOString(), ...(tipo === "fatto" || tipo === "secco" ? { litri: g?.litri ?? (t.notificati?.[data] || []).find((n) => n.id === pid)?.litri ?? null } : {}) });
  });
  await rispondi(`Registrato: ${nome} ${ETICHETTE[tipo]}`);
  const kb = cq.message?.reply_markup?.inline_keyboard;
  if (kb) {
    const gruppo = x === "c" ? "c" : "w";
    const nuova = kb.map((row) => {
      const cb = row.map((b) => b.callback_data || "");
      const stessa = cb.some((c) => c.startsWith(`g|${data}|${pid}|`)), suo = cb.some((c) => c.endsWith("|c")) ? "c" : "w";
      return stessa && suo === gruppo ? [{ text: `✔ ${corto(nome)}: ${ETICHETTE[tipo]}`, callback_data: "x" }] : row;
    });
    await tg(t.token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: nuova } }, { ignora: true });
  }
}
