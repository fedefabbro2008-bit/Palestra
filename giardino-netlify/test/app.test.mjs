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

  // sul server, e il codice mai negli indirizzi
  CODICE = await page.evaluate(() => window.GiardinoNet.codice());
  await quando(page, () => !localStorage.getItem("giardino:net:pending"));
  const srv = JSON.parse(await (await dati(new Request("https://x/api/dati", { headers: { "x-giardino-code": CODICE } }))).text());
  assert.equal(srv.data.plants.length, 5);
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
    for (const vista of ["oggi", "piante", "diario", "impostazioni", "modulo"]) {
      if (vista === "modulo") {
        await page.click("#tab-piante"); await page.evaluate(() => { document.querySelector("#plantList details.plant").open = true; });
        await page.click("#plantList details.plant >> nth=0 >> [data-edit]"); await page.click("#pf-specie-btn"); await page.evaluate(() => { document.querySelector("#pf-more").open = true; });
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
