// Interfaccia nel browser (Playwright): flusso completo e niente fuori schermo da 320 a 430 px.
// Si lancia con:  node --import ./test/registra-finto.mjs --test test/app.test.mjs   (dalla cartella giardino-netlify)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { giorni, OGGI } from "./rete-finta.mjs";
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dati = (await import("../netlify/functions/dati.mjs")).default;
const PUB = fileURLToPath(new URL("../public/", import.meta.url));
const SITO = "https://giardino.test/";
const RICHIESTE = [];   // richieste a /api/dati, per controllare che l'app non ne faccia più del necessario
const json = (o) => ({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

async function contesto(browser, opz = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT", timezoneId: "UTC", acceptDownloads: true, ...opz });
  await ctx.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill(json({ results: [{ name: "Castrocaro Terme", admin1: "Emilia-Romagna", country: "Italia", latitude: 44.176, longitude: 11.95, elevation: 68 }] })));
  // fonti esterne non usate nei test: niente dati (le fasi restano a giorni, niente riserva né stazioni)
  for (const u of ["https://historical-forecast-api.open-meteo.com/**", "https://api.met.no/**", "https://dati-simc.arpae.it/**"]) await ctx.route(u, (r) => r.fulfill({ status: 503, body: "" }));
  await ctx.route("https://api.open-meteo.com/**", (r) => {
    if (r.request().url().includes("models=italia")) return r.fulfill(json({ hourly: { time: [], precipitation: [], temperature_2m: [] } }));
    const ore = giorni.slice(3, 5).flatMap((d) => [...Array(24)].map((_, h) => d + "T" + String(h).padStart(2, "0") + ":00"));
    return r.fulfill(json({ daily: { time: giorni, weather_code: giorni.map((_, i) => [0, 2, 3, 61, 0, 2, 95, 61, 3, 0, 45][i]), temperature_2m_max: giorni.map(() => 22), temperature_2m_min: giorni.map(() => 9), precipitation_sum: giorni.map((_, i) => (i === 6 ? 9 : 0)), precipitation_probability_max: giorni.map(() => 20), et0_fao_evapotranspiration: giorni.map(() => 3.5), wind_speed_10m_max: giorni.map(() => 8) },
      hourly: { time: ore, temperature_2m: ore.map(() => 8), soil_moisture_0_to_1cm: ore.map(() => 0.2), soil_moisture_1_to_3cm: ore.map(() => 0.2), soil_moisture_3_to_9cm: ore.map(() => 0.2), soil_moisture_9_to_27cm: ore.map(() => 0.2) } }));
  });
  await ctx.route(SITO + "**", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/api/dati")) {
      RICHIESTE.push(r.request().method() + " " + (u.searchParams.get("op") || "dati") + (r.request().headers()["x-giardino-versione"] ? " (versione)" : ""));
      const res = await dati(new Request(u.href, { method: r.request().method(), headers: r.request().headers(), body: r.request().postData() || undefined }));
      return r.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    }
    const f = PUB + (u.pathname === "/" ? "index.html" : u.pathname.slice(1));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "no" });
    const tipo = f.endsWith(".js") ? "text/javascript" : f.endsWith(".png") ? "image/png" : f.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
    return r.fulfill({ contentType: tipo, body: fs.readFileSync(f) });
  });
  return ctx;
}
const pronta = (page) => page.waitForFunction(() => typeof ready !== "undefined" && ready === true);
const quando = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 });
const scegliSpecie = async (page, cerca, k) => { await page.click("#pf-specie-btn"); await page.fill("#pf-cerca", cerca); await page.click(`#pf-plist [data-sp="${k}"]`); };

let CODICE;
test("flusso completo a 390 px", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const ctx = await contesto(browser), page = await ctx.newPage();
  const errori = [], conCodice = [];
  page.on("pageerror", (e) => errori.push(e.message));
  page.on("request", (r) => { if (r.url().includes("code=")) conCodice.push(r.url()); });
  RICHIESTE.length = 0;
  await page.goto(SITO); await pronta(page);
  await page.waitForTimeout(300);
  assert.deepEqual(RICHIESTE, ["GET dati"], "all'avvio una sola richiesta al server (lo stato di Claude e Telegram solo in Impostazioni)");

  // zoom bloccato e campi a 16 px
  assert.match(await page.getAttribute("meta[name=viewport]", "content"), /user-scalable=no/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction), "pan-x pan-y");
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("input:not([type=radio]):not([type=checkbox]):not([type=file]):not([type=hidden]),select,textarea")].every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16)));

  // primo avvio: comune ed esempi
  assert.ok(await page.isVisible("#onboarding"));
  await page.fill("#obLoc", "castrocaro"); await page.click("#obLocSet");
  await quando(page, () => document.querySelector("#obLocInfo").textContent.includes("Castrocaro"));
  await quando(page, () => document.querySelectorAll("#wxStrip .wx-day").length >= 5);
  assert.equal(await page.locator("#wxStrip .wx-day:visible").count(), 5);
  await page.click("#exampleBtn");
  await quando(page, () => document.querySelectorAll("#todayList .task").length > 0);
  assert.ok(!(await page.isVisible("#onboarding")));

  // Oggi senza zone: “Annaffiate tutte” e Annulla
  const da = await page.locator('#todayList [data-ev="fatto"]').count();
  if (da >= 2) {
    await page.click('[data-tutte="*"]'); await page.waitForTimeout(200);
    assert.equal(await page.locator('#todayList [data-ev="fatto"]').count(), 0, "tutte segnate");
    assert.equal(await page.locator("#todayList [data-undo]").count(), da);
    await page.click("#todayList [data-undo] >> nth=0"); await page.waitForTimeout(200);
    assert.equal(await page.locator("#todayList [data-undo]").count(), da - 1);
  }
  const giornoChiuso = page.locator("#weekList details.day summary").first();
  if (await giornoChiuso.count()) { await giornoChiuso.click(); assert.ok(await page.locator("#weekList details[open] .why-list li").count() > 0); }

  // Piante: elenco in ordine alfabetico, ricerca della specie, zona, fase del bulbo
  await page.click("#tab-piante");
  assert.deepEqual(await page.locator("#plantList .pname").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim())), ["Fioriera aromatiche", "Limone in terrazzo", "Pothos in salotto"]);
  await page.click("#addPlantBtn");
  await page.fill("#pf-nome", "Aglio");
  assert.equal(await page.inputValue("#pf-specie"), "aglio", "specie riconosciuta dal nome");
  await page.click("#pf-specie-btn"); await page.fill("#pf-cerca", "agl");
  assert.deepEqual(await page.locator("#pf-plist [data-sp]").evaluateAll((els) => els.map((e) => e.dataset.sp)), ["aglio", "appartamento"], "aglio e aglaonema");
  await page.fill("#pf-cerca", "limone");
  assert.deepEqual(await page.locator("#pf-plist [data-sp]").evaluateAll((els) => els.map((e) => e.dataset.sp)), ["agrumi"], "trova anche i sinonimi");
  await page.fill("#pf-cerca", ""); const tutte = await page.locator("#pf-plist [data-sp]").evaluateAll((els) => els.map((e) => e.textContent));
  assert.equal(tutte.at(-1), "🌱Altra pianta"); assert.ok(tutte[0].includes("Aglio"));
  await page.fill("#pf-cerca", "agl"); await page.press("#pf-cerca", "Enter");
  assert.equal(await page.inputValue("#pf-specie"), "aglio");
  assert.equal(await page.inputValue("#pf-tipo-data"), "semina");
  await page.fill("#pf-semina", OGGI); await page.dispatchEvent("#pf-semina", "input");
  assert.match(await page.textContent("#pf-fase-hint"), /germinazione/);
  assert.ok((await page.locator("#pf-fase option").allTextContents()).includes("Ingrossamento del bulbo"));
  await page.click("label:has(input[name=materiale][value=chiuso])");
  assert.match(await page.textContent("#pf-mat-hint"), /dose esatta/);
  await page.fill("#pf-riserva", "1,5");
  await page.fill("#pf-zona", "orto"); await page.click("button[type=submit]"); await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => { const p = S.plants.find((x) => x.nome === "Aglio"); return [p.materiale, p.riserva]; }), ["chiuso", 1.5]);
  // seconda pianta nella stessa zona, scelta con il pulsante rapido; la maiuscola viene da quella già esistente
  await page.click("#addPlantBtn"); await page.fill("#pf-nome", "Zucchine"); await scegliSpecie(page, "zucc", "zucchina");
  await page.click('#pf-zona-q [data-zona="orto"]'); await page.click('[data-vaso="30"]'); await page.click('[data-luce="8"]');
  await page.click("label:has(input[name=dove][value=aperto])");
  await page.click("#pf-more summary"); await page.click("#pf-cons-add"); await page.fill("#pf-cons [data-c=num]", "2");
  await page.click("button[type=submit]"); await page.waitForTimeout(200);
  const nuove = await page.evaluate(() => S.plants.slice(-2).map((p) => [p.nome, p.zona, p.specie, p.vaso, p.consociate.length]));
  assert.deepEqual(nuove, [["Aglio", "orto", "aglio", 12, 0], ["Zucchine", "orto", "zucchina", 30, 1]]);
  assert.deepEqual(await page.locator("#plantList .zhead span").allTextContents(), ["orto", "Senza zona"]);

  // pianta in casa: temperature per stagione (solo per chi è in casa), uguali per tutte se richiesto
  await page.evaluate(() => { document.querySelectorAll("#plantList details.plant").forEach((d) => (d.open = true)); });
  await page.click('#plantList details.plant:has-text("Pothos") [data-edit]');
  assert.ok(await page.isVisible("#pf-t-inverno"));
  assert.equal(await page.inputValue("#pf-t-estate"), "26");
  await page.fill("#pf-t-inverno", "16"); await page.check("#pf-t-tutte"); await page.click("button[type=submit]");
  assert.deepEqual(await page.evaluate(() => S.plants.find((p) => p.nome.startsWith("Pothos")).tcasa), { inverno: 16, primavera: 21, estate: 26, autunno: 21 });
  assert.match(await page.textContent('#plantList details.plant:has-text("Pothos") .facts'), /In casa oggi≈ \d+ °C/);
  await page.evaluate(() => { document.querySelectorAll("#plantList details.plant").forEach((d) => (d.open = true)); });
  await page.click('#plantList details.plant:has-text("Limone") [data-edit]');
  assert.ok(!(await page.isVisible("#pf-t-inverno")), "fuori casa niente temperature");
  await page.click("label:has(input[name=dove][value=serra])");
  assert.ok(await page.isVisible("#pf-t-inverno"));
  assert.match(await page.textContent("#pf-t-titolo"), /veranda/);
  assert.equal(await page.inputValue("#pf-t-inverno"), "10", "valori tipici della serra");
  await page.click("#cancelPlantBtn");

  // scheda: prima il calendario automatico, poi quella scritta da Claude con la tabella dei mesi
  await page.evaluate(() => { document.querySelectorAll("#plantList details.plant").forEach((d) => (d.open = true)); });
  await page.click('#plantList details.plant:has-text("Aglio") [data-scheda]');
  assert.ok(await page.isVisible("#schedaPanel"));
  assert.match(await page.textContent("#schBody"), /Calendario dalla semina al raccolto/);
  assert.ok((await page.locator("#schBody table.mesi tr").count()) >= 8);
  assert.equal(await page.locator("#schBody table.mesi tr.ora").count(), 1, "il mese corrente è evidenziato");
  assert.match(await page.textContent("#schBody"), /Raccolta: /);
  assert.ok(await page.isVisible("#schBody [data-copia]"));
  // senza Claude: scheda dell'app con condizioni e fasi
  assert.match(await page.textContent("#schBody"), /Scheda dell'app[\s\S]*Condizioni ideali[\s\S]*Fasi di crescita[\s\S]*Ingrossamento del bulbo/);
  // diagnosi guidata: terriccio bagnato + foglie gialle molli → troppa acqua, registrata
  await page.click("#schDiag summary");
  await page.check('#schDiag input[value="bagnato"]'); await page.check('#schDiag input[value="gialle_molli"]');
  await page.click("#schDiag [data-diag]");
  assert.match(await page.textContent("#diagEsito"), /Troppa acqua/);
  await page.click("#schDiag [data-diag-reg]");
  assert.ok(await page.evaluate(() => S.eventi_app.some((e) => e.tipo === "meno")), "evento «meno» registrato");
  const codice = await page.evaluate(() => window.GiardinoNet.codice());
  await quando(page, () => !localStorage.getItem("giardino:net:pending"));
  const sul = JSON.parse(await (await dati(new Request("https://x/api/dati", { headers: { "x-giardino-code": codice } }))).text()).data;
  const conScheda = sul.plants.map((p) => (p.nome === "Aglio" ? { ...p, scheda: { aggiornata: new Date().toISOString(), specie: "aglio", data_semina: p.data_semina, descrizione: "Si pianta in autunno.",
    condizioni: { luce: "Pieno sole" }, stagioni: { inverno: "Resiste al freddo", estate: "Si raccoglie" }, fasi: [{ quando: "Settimane 1–3", fase: "Radicazione", cosa: "Niente acqua" }],
    calendario: [{ mese: OGGI.slice(0, 7), fase: "Radicazione" }, { mese: "2027-06", fase: "Raccolta", raccolta: true }], frutti: "Raccolta a giugno", consigli: ["Poca acqua"] } } : p));
  await dati(new Request("https://x/api/dati", { method: "POST", headers: { "x-giardino-code": codice, "content-type": "application/json" }, body: JSON.stringify({ changes: { plants: conScheda } }) }));
  await page.evaluate(() => window.GiardinoNet.aggiorna(false));
  await quando(page, () => document.querySelector("#schBody").textContent.includes("Scheda di Claude"));
  const testoScheda = await page.textContent("#schBody");
  for (const t of ["Si pianta in autunno.", "Condizioni ideali", "Pieno sole", "Nelle stagioni", "Settimane 1–3 · Radicazione", "Calendario dei mesi", "Raccolta a giugno", "Poca acqua"]) assert.ok(testoScheda.includes(t), t);
  assert.equal(await page.locator("#schBody table.mesi tr").count(), 2);
  assert.ok(!(await page.isVisible("#schBody [data-copia]")), "niente richiesta a Claude se la scheda c'è");
  await page.click("#schChiudi");

  // Oggi con le zone: sezione per zona
  await page.click("#tab-oggi");
  assert.ok((await page.locator("#todayList .zhead span").allTextContents()).includes("orto"));

  // Diario a calendario: oggi ha l'icona dell'acqua (Pothos segnata più su)
  await page.click("#tab-diario");
  assert.equal(await page.locator("#cal [data-giorno]").count(), new Date(+OGGI.slice(0, 4), +OGGI.slice(5, 7), 0).getDate());
  assert.match(await page.textContent(`#cal [data-giorno="${OGGI}"]`), /💧/);
  await page.click(`#cal [data-giorno="${OGGI}"]`);
  assert.match(await page.textContent("#calGiorno"), /annaffiata|innaffiata/);
  await page.click("#calPrima"); assert.ok(!(await page.isDisabled("#calDopo")));

  // Impostazioni: crediti
  RICHIESTE.length = 0;
  await page.evaluate(() => window.GiardinoNet.aggiorna(false));
  assert.deepEqual(RICHIESTE, ["GET dati (versione)"], "controllo periodico: chiede solo se è cambiato qualcosa");
  await page.click("#tab-impostazioni");
  await quando(page, () => document.querySelector("#tgChip").textContent && document.querySelector("#tgChip").textContent !== "…");
  assert.deepEqual(RICHIESTE.slice(1), ["GET stato"], "Claude, Telegram e crediti in una richiesta sola");
  await page.click("#set-crediti summary");
  await quando(page, () => /pubblicazion/.test(document.querySelector("#credTesto").textContent));

  await page.click("#tab-impostazioni");
  await page.click("#set-mis summary"); await page.fill("#impA", "12"); await page.fill("#impB", "0,3"); await page.click("#impSave");
  assert.deepEqual(await page.evaluate(() => [S.impostazioni.annaffiatoio, S.impostazioni.bicchiere]), [12, 0.3]);
  // Notifiche: un interruttore per tipo, salvato subito sul server; salvare le misure non le cancella
  await page.click("#set-not summary");
  assert.equal(await page.textContent("#notVal"), "tutte"); assert.equal(await page.locator("#notList input.sw:checked").count(), 8);
  await page.click('#notList [data-not="riepilogo"]'); await page.click('#notList [data-not="mattina"]');
  assert.equal(await page.textContent("#notVal"), "6 su 8"); assert.match(await page.textContent("#notHint"), /la sera ti scrive lo stesso/);
  await page.fill("#impA", "11"); await page.click("#impSave");
  assert.deepEqual(await page.evaluate(() => S.impostazioni.notifiche), { riepilogo: false, mattina: false });
  await page.evaluate(() => window.GiardinoNet.aggiorna(false));
  { const cod = await page.evaluate(() => window.GiardinoNet.codice()), srv = JSON.parse(await (await dati(new Request("https://x/api/dati", { headers: { "x-giardino-code": cod } }))).text()).data.impostazioni;
    assert.equal(srv.annaffiatoio, 11); assert.deepEqual(srv.notifiche, { riepilogo: false, mattina: false }, "sul server: il bot le legge da qui"); }
  await page.click('#notList [data-not="mattina"]');
  assert.equal(await page.textContent("#notVal"), "7 su 8"); assert.ok(await page.isHidden("#notHint"));
  await page.click("#set-claude summary"); await page.click("#mcpOn");
  await quando(page, () => document.querySelector("#mcpUrl").textContent.length > 10);
  assert.match(await page.textContent("#mcpUrl"), /\/mcp\/[A-Z2-7]{26}$/);
  await page.click("#set-bk summary");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 3000 }), page.click("#bkSave")]);
  await page.setInputFiles("#bkFile", await dl.path()); await page.click("#bkYes");
  assert.match(await page.textContent("#bkStatus"), /Importato: 5 piante/);
  await page.click("#set-sync summary"); await page.click("#syncBtn");
  await quando(page, () => document.querySelector("#syncStatus").textContent === "Aggiornato.");

  // piano di Claude che finisce domani: l'app lo dice e dopo usa il calcolo automatico
  {
    const cod = await page.evaluate(() => window.GiardinoNet.codice());
    await quando(page, () => !localStorage.getItem("giardino:net:pending"));
    const domani = giorni[4], pid = await page.evaluate(() => S.plants.find((p) => p.nome === "Zucchine").id);
    const piano = { createdAt: new Date().toISOString(), source: "claude", data: { sintesi: "", avvisi: [], piante: [{ id: pid, giorni: [OGGI, domani].map((data) => ({ data, azione: "salta", litri: 0, momento: "indifferente", motivo: "prova" })) }] } };
    await dati(new Request("https://x/api/dati", { method: "POST", headers: { "x-giardino-code": cod, "content-type": "application/json" }, body: JSON.stringify({ changes: { piano_claude: piano } }) }));
    await page.evaluate(() => window.GiardinoNet.aggiorna(false));
    await page.click("#tab-oggi");
    await quando(page, () => document.querySelector("#planSrc").textContent.includes("Finisce domani"));
    const giorniZucchine = await page.evaluate((id) => activePlan().data.piante.find((x) => x.id === id).giorni.length, pid);
    assert.ok(giorniZucchine >= 7, "dopo la fine del piano di Claude: calcolo automatico");
    await page.click("#localBtn");
  }

  // una modifica fatta un attimo prima dell'aggiornamento automatico non deve sparire,
  // anche se nel frattempo un altro dispositivo (o Claude, o Telegram) ha cambiato i dati sul server
  CODICE = await page.evaluate(() => window.GiardinoNet.codice());
  await page.evaluate(() => { S.plants.find((p) => p.nome === "Aglio").note = "non perdermi"; saveMain(); });
  await dati(new Request("https://x/api/dati", { method: "POST", headers: { "x-giardino-code": CODICE, "content-type": "application/json" }, body: JSON.stringify({ changes: { vacanza: null } }) }));
  await page.evaluate(() => window.GiardinoNet.aggiorna(false));
  assert.equal(await page.evaluate(() => S.plants.find((p) => p.nome === "Aglio").note), "non perdermi", "modifica locale persa dall'aggiornamento");

  // subito dopo la riapertura dell'app, la modifica di una pianta esistente arriva al server
  // (prima lo stato sullo schermo condivideva gli oggetti con la sincronizzazione e la modifica non partiva)
  await page.reload(); await pronta(page);
  await page.click("#tab-piante"); await page.evaluate(() => document.querySelectorAll("#plantList details.plant").forEach((d) => (d.open = true)));
  await page.click('#plantList details.plant:has-text("Limone") [data-edit]');
  await page.evaluate(() => { document.querySelector("#pf-more").open = true; }); await page.fill("#pf-note", "nota dopo la riapertura"); await page.click("button[type=submit]");
  await quando(page, () => !scrittureInSospeso() && !localStorage.getItem("giardino:net:pending"));
  await page.waitForTimeout(200);
  const dopo = JSON.parse(await (await dati(new Request("https://x/api/dati", { headers: { "x-giardino-code": CODICE } }))).text()).data;
  assert.equal(dopo.plants.find((p) => p.nome.startsWith("Limone")).note, "nota dopo la riapertura", "modifica dopo la riapertura non arrivata al server");

  // sul server, e il codice mai negli indirizzi
  await quando(page, () => !localStorage.getItem("giardino:net:pending"));
  const srv = JSON.parse(await (await dati(new Request("https://x/api/dati", { headers: { "x-giardino-code": CODICE } }))).text());
  assert.equal(srv.data.plants.length, 5);
  assert.equal(srv.data.plants.find((p) => p.nome === "Aglio").note, "non perdermi");
  assert.deepEqual(conCodice, [], "il codice non deve stare negli indirizzi");
  assert.deepEqual(errori, []);
});

test("niente fuori schermo, chiaro e scuro, da 320 a 430 px", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  for (const [W, schema] of [[320, "light"], [360, "light"], [375, "light"], [390, "dark"], [430, "light"]]) {
    const ctx = await contesto(browser, { viewport: { width: W, height: 800 }, colorScheme: schema });
    await ctx.addInitScript((c) => localStorage.setItem("giardino:net:code", c), CODICE);
    const page = await ctx.newPage(); await page.goto(SITO); await pronta(page);
    await quando(page, () => document.querySelectorAll("#todayList .task, #restList .lrow").length > 0);
    for (const vista of ["oggi", "piante", "diario", "impostazioni", "modulo", "scheda"]) {
      if (vista === "modulo") {
        await page.click("#tab-piante"); await page.evaluate(() => { document.querySelector("#plantList details.plant").open = true; });
        await page.click("#plantList details.plant >> nth=0 >> [data-edit]"); await page.click("#pf-specie-btn"); await page.evaluate(() => { document.querySelector("#pf-more").open = true; });
      } else if (vista === "scheda") {
        await page.click("#cancelPlantBtn"); await page.evaluate(() => { document.querySelectorAll("#plantList details.plant").forEach((d) => (d.open = true)); });
        await page.click('#plantList details.plant:has-text("Aglio") [data-scheda]');
      } else await page.click("#tab-" + vista);
      await page.evaluate(() => document.querySelectorAll("section.view:not([hidden]) details").forEach((d) => (d.open = true))); await page.waitForTimeout(150);
      const fuori = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth, out = [];
        for (const el of document.querySelectorAll("section.view:not([hidden]) *, nav.tabs *")) {
          const r = el.getBoundingClientRect(); if (!r.width || el.closest("[hidden]") || el.closest(".hfx")) continue;   // .hfx: meteo decorativo, tagliato dal riquadro
          if (r.right > vw + 0.5 || r.left < -0.5) out.push((el.id || el.className?.baseVal || el.className || el.tagName) + " " + Math.round(r.left) + "→" + Math.round(r.right));
          const s = getComputedStyle(el);
          if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) out.push("scorre di lato: " + (el.id || el.className));
        }
        if (document.documentElement.scrollWidth > vw) out.push("pagina più larga dello schermo");
        return [...new Set(out)].slice(0, 6);
      });
      assert.deepEqual(fuori, [], `${W} px ${schema}, ${vista}`);
    }
    await ctx.close();
  }
});

test("backup su iPhone: si condivide solo il file JSON (niente .txt con il titolo)", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const ctx = await contesto(browser, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript((c) => {
    localStorage.setItem("giardino:net:code", c);
    navigator.canShare = () => true;
    navigator.share = (d) => { window.__condiviso = { chiavi: Object.keys(d), file: d.files?.map((f) => [f.name, f.type]) }; return Promise.resolve(); };
  }, CODICE);
  const page = await ctx.newPage(); await page.goto(SITO); await pronta(page);
  await page.click("#tab-impostazioni"); await page.click("#set-bk summary"); await page.click("#bkSave");
  await quando(page, () => !!window.__condiviso);
  const c = await page.evaluate(() => window.__condiviso);
  assert.deepEqual(c.chiavi, ["files"], "solo il file, senza titolo né testo");
  assert.equal(c.file.length, 1);
  assert.match(c.file[0][0], /^giardino-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(c.file[0][1], "application/json");
});

test("schede: cambiano al tocco anche subito dopo un'altra (animazione in corso), una volta sola", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const ctx = await contesto(browser), page = await ctx.newPage();
  const errori = []; page.on("pageerror", (e) => errori.push(e.message));
  await page.goto(SITO); await pronta(page);
  await page.evaluate(() => { window.__cambi = 0; const o = window.switchView; window.switchView = (v) => { window.__cambi++; return o(v); }; });
  const visibile = (v) => page.evaluate((v) => !document.getElementById("view-" + v).hidden, v);
  await page.tap("#tab-piante");
  assert.ok(await visibile("piante")); assert.equal(await page.evaluate(() => window.__cambi), 1, "tocco: un cambio solo (il click che segue non conta)");
  await page.tap("#tab-diario");   // la vista di prima sta ancora entrando
  assert.ok(await visibile("diario"), "secondo tocco durante l'animazione");
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__cambi), 2);
  await page.click("#tab-oggi");   // mouse o tastiera: il click
  assert.ok(await visibile("oggi")); assert.equal(await page.evaluate(() => window.__cambi), 3);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("nav.tabs")).touchAction), "none", "la barra non fa scorrere né zoomare");
  assert.deepEqual(errori, []);
});

test("finestra del meteo aperta: la pagina sotto non scorre e alla chiusura resta dov'era", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const CODE = "PROVA-FINESTRA-METEO-ABCDEF";
  await dati(new Request("https://x/api/dati", { method: "POST", headers: { "x-giardino-code": CODE, "content-type": "application/json" },
    body: JSON.stringify({ changes: { location: { name: "Castrocaro Terme", detail: "Emilia-Romagna, Italia", lat: 44.176, lon: 11.95 } } }) }));
  const ctx = await contesto(browser, { viewport: { width: 390, height: 600 } });
  await ctx.addInitScript((c) => localStorage.setItem("giardino:net:code", c), CODE);
  const page = await ctx.newPage(), errori = []; page.on("pageerror", (e) => errori.push(e.message));
  await page.goto(SITO); await pronta(page);
  await quando(page, () => document.querySelector("[data-wxd]"));
  await page.evaluate(() => document.body.appendChild(Object.assign(document.createElement("div"), { id: "lungo", style: "height:2000px" })));   // pagina lunga
  await page.evaluate(() => window.scrollTo(0, 120)); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector("[data-wxd]").click());
  await quando(page, () => !document.getElementById("wxSheet").hidden);
  // la pagina non si tocca (prima: corpo fisso e poi riportato dov'era, e alla chiusura tutta la pagina si ridisegnava)
  assert.equal(await page.evaluate(() => document.body.style.position), "", "nessun cambio alla pagina");
  await page.mouse.move(195, 80); await page.mouse.wheel(0, 400); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 120, "la rotellina non fa scorrere la pagina sotto");
  // trascinando il dito sullo sfondo scuro la pagina sotto resta ferma
  const cdp = await ctx.newCDPSession(page), tocca = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
  await tocca("touchStart", 60); for (const y of [100, 160, 220, 300]) await tocca("touchMove", y); await tocca("touchEnd"); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 120, "il dito sullo sfondo non fa scorrere la pagina");
  await page.evaluate(() => chiudiMeteo());   // (il tocco sullo sfondo può averla già chiusa)
  await quando(page, () => document.getElementById("wxSheet").hidden);
  assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 120, "chiusa: la pagina è dov'era, senza salti");
  // senza finestre aperte la pagina scorre di nuovo col dito
  await tocca("touchStart", 400); for (const y of [360, 300, 240, 180]) await tocca("touchMove", y); await tocca("touchEnd"); await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => window.scrollY) > 150, "la pagina scorre");
  assert.deepEqual(errori, []);
});

test("storico salvato una volta sola sul telefono e usato per il bilancio dell'acqua", async (t) => {
  const { addDays } = await import("../netlify/lib/modello.mjs");
  const browser = await chromium.launch(); t.after(() => browser.close());
  const CODE = "PROVA-STORICO-UNA-VOLTA-ABCDEF";
  await dati(new Request("https://x/api/dati", { method: "POST", headers: { "x-giardino-code": CODE, "content-type": "application/json" },
    body: JSON.stringify({ changes: { location: { name: "Castrocaro Terme", detail: "Emilia-Romagna, Italia", lat: 44.176, lon: 11.95 },
      plants: [{ id: "su", nome: "Aloe", specie: "succulenta", fase: "auto", colt: "vaso", vaso: 2, luce: 4, dove: "interno" }] } }) }));
  const ctx = await contesto(browser);
  const time = [...Array(400)].map((_, i) => addDays(OGGI, i - 400)), n = (v) => time.map(() => v);
  await ctx.route("https://historical-forecast-api.open-meteo.com/**", (r) => r.fulfill(json({ daily: { time, temperature_2m_mean: n(11), temperature_2m_max: n(16), temperature_2m_min: n(6),
    precipitation_sum: n(0), et0_fao_evapotranspiration: n(1.2), sunshine_duration: n(18000), daylight_duration: n(36000), wind_speed_10m_max: n(8) } })));
  await ctx.addInitScript((c) => localStorage.setItem("giardino:net:code", c), CODE);
  const page = await ctx.newPage(), errori = []; page.on("pageerror", (e) => errori.push(e.message));
  await page.goto(SITO); await pronta(page);
  // una copia per posizione (più orti): chiavi con la posizione
  await quando(page, () => (localStorage.getItem("giardino:net:storico@44.18,11.95") || "").includes('"arch"') && localStorage.getItem("giardino:net:meteo@44.18,11.95"));
  const r = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("giardino:net:meteo@44.18,11.95")), s = JSON.parse(localStorage.getItem("giardino:net:storico@44.18,11.95"));
    return { meteoHaStorico: "storico" in m || "archivio" in m, arch: Object.keys(s.arch).length, passati: pastDays().length }; });
  assert.equal(r.meteoHaStorico, false, "il meteo salvato non ripete lo storico");
  assert.equal(r.arch, 400);
  assert.ok(r.passati >= 100, "bilancio con " + r.passati + " giorni passati");
  assert.deepEqual(errori, []);
});

test("più orti: ognuno con la sua città, le sue piante e il suo meteo; nuovo orto; pianta spostata", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const CODE = "PROVA-PIU-ORTI-ABCDEFGHIJKL", H = { "x-giardino-code": CODE, "content-type": "application/json" };
  await dati(new Request("https://x/api/dati", { method: "POST", headers: H, body: JSON.stringify({ changes: {
    location: { name: "Castrocaro Terme", detail: "Emilia-Romagna, Italia", lat: 44.176, lon: 11.95 },
    orti: [{ id: "o1", nome: "Mare", location: { name: "Rimini", detail: "Emilia-Romagna, Italia", lat: 44.06, lon: 12.57 } }],
    plants: [{ id: "ag", nome: "Aglio", specie: "aglio", fase: "auto", colt: "vaso", vaso: 30, luce: 4, dove: "aperto" },
      { id: "ba", nome: "Basilico", specie: "basilico", fase: "auto", colt: "vaso", vaso: 3, luce: 6, dove: "aperto", orto: "o1" }] } }) }));
  const ctx = await contesto(browser), lat = [];
  await ctx.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill(json({ results: [{ name: "Bologna", admin1: "Emilia-Romagna", country: "Italia", latitude: 44.494, longitude: 11.343, elevation: 54 }] })));
  await ctx.route("https://api.open-meteo.com/**", (r) => { lat.push(new URL(r.request().url()).searchParams.get("latitude")); return r.fallback(); });
  await ctx.addInitScript((c) => localStorage.setItem("giardino:net:code", c), CODE);
  const page = await ctx.newPage(), errori = []; page.on("pageerror", (e) => errori.push(e.message));
  const nomi = () => page.evaluate(() => [...document.querySelectorAll("#plantList .pname")].map((x) => x.textContent.trim()));
  await page.goto(SITO); await pronta(page);
  await quando(page, () => document.querySelector("#locName").textContent === "Castrocaro Terme");
  await page.evaluate(() => switchView("piante"));
  assert.deepEqual(await nomi(), ["Aglio"], "orto principale: solo le sue piante");
  // l'altro orto: le sue piante e il meteo di Rimini
  await page.click("#locBtn"); await quando(page, () => !document.querySelector("#ortiSheet").hidden);
  assert.equal(await page.locator("#ortiLista [data-orto]").count(), 2);
  await page.click('#ortiLista [data-orto="o1"]');
  await quando(page, () => document.querySelector("#locName").textContent === "Mare");
  assert.deepEqual(await nomi(), ["Basilico"]);
  await quando(page, () => typeof S !== "undefined" && S.location?.name === "Rimini" && wxDays().length > 0);
  assert.ok(lat.some((x) => (+x).toFixed(2) === "44.06"), "meteo di Rimini: " + lat.join(","));
  assert.equal(await page.evaluate(() => localStorage.getItem("giardino:orto")), "o1", "l'orto scelto resta su questo telefono");
  // nuovo orto: Bologna, vuoto
  await page.click("#locBtn"); await quando(page, () => !document.querySelector("#ortiSheet").hidden);
  await page.click("#ortoNuovo summary"); await page.fill("#onNome", "Città"); await page.fill("#onLoc", "bologna"); await page.click("#onCrea");
  await quando(page, () => document.querySelector("#locName").textContent === "Città");
  assert.deepEqual(await nomi(), []);
  // il basilico torna nell'orto principale (dal modulo della pianta)
  await page.click("#locBtn"); await quando(page, () => !document.querySelector("#ortiSheet").hidden);
  await page.click('#ortiLista [data-orto="o1"]'); await quando(page, () => document.querySelector("#locName").textContent === "Mare");
  await page.evaluate(() => openForm("ba"));
  assert.ok(await page.isVisible("#pf-orto"), "con più orti il modulo chiede l'orto");
  await page.selectOption("#pf-orto", "p"); await page.evaluate(() => document.querySelector("#plantForm").requestSubmit());
  await quando(page, () => document.querySelectorAll("#plantList .pname").length === 0);
  await page.evaluate(() => salvaSubito()); await page.waitForTimeout(1500);
  const d = (await (await dati(new Request("https://x/api/dati", { headers: H }))).json()).data;
  assert.deepEqual(d.plants.map((p) => [p.id, p.orto || "p"]).sort(), [["ag", "p"], ["ba", "p"]], "basilico spostato, aglio dov'era");
  assert.deepEqual(d.orti.map((o) => [o.nome, o.location?.name]), [["Mare", "Rimini"], ["Città", "Bologna"]]);
  assert.equal(d.location.name, "Castrocaro Terme", "la posizione del principale non cambia");
  assert.deepEqual(errori, []);
});
