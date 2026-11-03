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
const json = (o) => ({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

async function contesto(browser, opz = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT", timezoneId: "UTC", acceptDownloads: true, ...opz });
  await ctx.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill(json({ results: [{ name: "Castrocaro Terme", admin1: "Emilia-Romagna", country: "Italia", latitude: 44.176, longitude: 11.95, elevation: 68 }] })));
  await ctx.route("https://api.open-meteo.com/**", (r) => {
    if (r.request().url().includes("hourly")) {
      const ore = giorni.slice(3, 5).flatMap((d) => [...Array(24)].map((_, h) => d + "T" + String(h).padStart(2, "0") + ":00"));
      return r.fulfill(json({ hourly: { time: ore, temperature_2m: ore.map(() => 8), soil_moisture_0_to_1cm: ore.map(() => 0.2), soil_moisture_1_to_3cm: ore.map(() => 0.2), soil_moisture_3_to_9cm: ore.map(() => 0.2), soil_moisture_9_to_27cm: ore.map(() => 0.2) } }));
    }
    return r.fulfill(json({ daily: { time: giorni, weather_code: giorni.map((_, i) => [0, 2, 3, 61, 0, 2, 95, 61, 3, 0, 45][i]), temperature_2m_max: giorni.map(() => 22), temperature_2m_min: giorni.map(() => 9), precipitation_sum: giorni.map((_, i) => (i === 6 ? 9 : 0)), precipitation_probability_max: giorni.map(() => 20), et0_fao_evapotranspiration: giorni.map(() => 3.5), wind_speed_10m_max: giorni.map(() => 8) } }));
  });
  await ctx.route(SITO + "**", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/api/dati")) {
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
  await page.goto(SITO); await pronta(page);

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
  await page.click("#pf-specie-btn"); await page.fill("#pf-cerca", "agl");
  assert.deepEqual(await page.locator("#pf-plist [data-sp]").evaluateAll((els) => els.map((e) => e.dataset.sp)), ["aglio"]);
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
  await page.fill("#pf-zona", "orto"); await page.click("button[type=submit]"); await page.waitForTimeout(200);
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

  // Impostazioni: Siri con l'indirizzo per zona
  await page.click("#tab-impostazioni"); await page.click("#set-siri summary");
  assert.match(await page.textContent("#siriUrl"), /\/api\/siri\/fatto$/);
  await page.selectOption("#siriZona", "orto");
  assert.match(await page.textContent("#siriUrl"), /\/api\/siri\/fatto\?zona=orto$/);
  await page.click("#set-mis summary"); await page.fill("#impA", "12"); await page.fill("#impB", "0,3"); await page.click("#impSave");
  assert.deepEqual(await page.evaluate(() => [S.impostazioni.annaffiatoio, S.impostazioni.bicchiere]), [12, 0.3]);
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
          const r = el.getBoundingClientRect(); if (!r.width || el.closest("[hidden]")) continue;
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
