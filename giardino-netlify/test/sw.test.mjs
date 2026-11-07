// Rete vera nel browser (Playwright) con un server su localhost: la rete del service worker non passa da page.route, e la
// compressione delle risposte la decodifica Chromium come sul telefono.
//  · service worker: apertura dalla copia anche con rete lenta o assente, versione nuova (ricarica subito se l'app non è
//    stata toccata, se no al ritorno sull'app, mai con una finestra aperta né due volte entro un minuto), dati mai dalla copia
//  · risposte compresse (gzip) lette dall'app; se la compressione arriva rovinata l'app riprova in chiaro
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
const dati = (await import("../netlify/functions/dati.mjs")).default;
const PUB = fileURLToPath(new URL("../public/", import.meta.url));
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

// sito su localhost: pagina (con versione e ritardo a scelta), file, /api/dati vera con l'archivio finto
async function sito(t) {
  const s = { versione: "A", giu: false, ritardo: 0, rovina: 0, guasta: 0, api: [] };
  const pagina = (v) => fs.readFileSync(PUB + "index.html", "utf8")
    .replace(/(<meta name="giardino-build" content=")\w+/, (m, a) => a + v.toLowerCase().repeat(12))
    .replace("</body>", `<script>window.VERSIONE_PROVA=${JSON.stringify(v)}</script></body>`);
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (s.giu) return req.socket.destroy();
    if (u.pathname.startsWith("/api/")) {
      const body = await new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
      const h = {}; for (const k of ["x-giardino-code", "x-giardino-versione", "x-giardino-gzip", "content-type", "accept-encoding"]) if (req.headers[k]) h[k] = req.headers[k];
      const r = await dati(new Request("http://localhost" + req.url, { method: req.method, headers: h, body: body || undefined }));
      const out = Object.fromEntries(r.headers), gz = out["content-encoding"] === "gzip";
      let corpo = Buffer.from(await r.arrayBuffer()), segno = gz ? " gzip" : "";
      if (gz && s.rovina > 0) { s.rovina--; delete out["content-encoding"]; segno = " rovinata"; }   // un proxy toglie l'intestazione: byte compressi illeggibili
      else if (gz && s.guasta > 0) { s.guasta--; corpo = gunzipSync(corpo); segno = " guasta"; }       // intestazione gzip ma byte in chiaro: il browser fallisce
      s.api.push(req.method + (h["x-giardino-gzip"] === "no" ? " chiaro" : "") + segno);
      res.writeHead(r.status, out); return res.end(corpo);
    }
    if (u.pathname === "/") { if (s.ritardo) await attesa(s.ritardo); res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }); return res.end(pagina(s.versione)); }
    const f = PUB + u.pathname.slice(1);
    if (!fs.existsSync(f) || u.pathname.endsWith("/")) { res.writeHead(404); return res.end("no"); }
    const tipo = f.endsWith(".js") ? "text/javascript" : f.endsWith(".png") ? "image/png" : "application/manifest+json";
    res.writeHead(200, { "content-type": tipo, "cache-control": u.pathname === "/sw.js" ? "no-cache" : "public, max-age=0, must-revalidate" }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, "localhost", r)); t.after(() => srv.close());
  const browser = await chromium.launch(); t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "it-IT" });
  await ctx.route(/^https:\/\//, (r) => r.abort());   // niente fonti esterne (meteo): solo il sito locale
  s.url = `http://localhost:${srv.address().port}/`; s.page = await ctx.newPage(); s.errori = [];
  s.page.on("pageerror", (e) => s.errori.push(e.message));
  s.pronta = () => s.page.waitForFunction(() => typeof ready !== "undefined" && ready === true, null, { timeout: 15000 });
  return s;
}

test("service worker: apertura dalla copia e versioni nuove", async (t) => {
  const s = await sito(t), page = s.page;
  let nav = [];
  page.on("response", (r) => { if (r.request().isNavigationRequest()) nav.push(r.fromServiceWorker() ? "copia" : "rete"); else if (/\/(api|mcp)\b/.test(r.url()) && r.fromServiceWorker()) s.errori.push("dalla copia: " + r.url()); });
  const vers = async () => { for (let i = 0; i < 30; i++) { try { return await page.evaluate(() => window.VERSIONE_PROVA); } catch { await attesa(100); } } };
  const diventa = async (v, ms) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await attesa(100)) if ((await vers()) === v) return true; return false; };
  const visibile = (v) => page.evaluate((v) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v }); document.dispatchEvent(new Event("visibilitychange")); }, v);
  const tocca = () => page.evaluate(() => dispatchEvent(new PointerEvent("pointerdown")));
  // la copia salvata contiene già la versione v (la scarica il service worker in sottofondo)
  const inCopia = async (v) => { for (const t0 = Date.now(); Date.now() - t0 < 8000; await attesa(100)) if (await page.evaluate(async (v) => ((await (await caches.match("/"))?.text()) || "").includes(`VERSIONE_PROVA=${JSON.stringify(v)}`), v).catch(() => false)) return true; return false; };

  await page.goto(s.url); await s.pronta();
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 10000 });
  assert.deepEqual(nav, ["rete"], "la prima volta la pagina arriva dalla rete");

  // rete lenta: la pagina arriva subito dalla copia (prima si aspettava il sito fino a 3 secondi)
  s.ritardo = 3000; nav = [];
  let t0 = Date.now(); await page.reload(); await s.pronta();
  assert.deepEqual(nav, ["copia"]); assert.ok(Date.now() - t0 < 2000, "aperta in " + (Date.now() - t0) + " ms con la rete lenta");
  s.ritardo = 0; await attesa(3200);   // finisce la richiesta lenta in sottofondo (Chrome mette in fila quelle alla stessa pagina)

  // versione nuova, app appena aperta e non toccata: si ricarica da sola con la versione nuova
  s.versione = "B"; await page.reload();
  assert.ok(await diventa("B", 5000), "ricaricata da sola con la versione nuova");
  await s.pronta();

  // già toccata: niente ricarica adesso, né in sottofondo, ma al ritorno sull'app
  await page.evaluate(() => sessionStorage.removeItem("ricaricata"));
  s.versione = "C"; s.ritardo = 2000; await page.reload(); await s.pronta(); await tocca();
  assert.ok(await inCopia("C")); s.ritardo = 0; await attesa(300);
  assert.equal(await vers(), "B", "toccata prima dell'avviso: resta aperta la versione di prima");
  await visibile("hidden"); await attesa(200);
  assert.equal(await vers(), "B", "in sottofondo nessuna ricarica");
  await visibile("visible");
  assert.ok(await diventa("C", 4000), "al ritorno sull'app la versione nuova");
  await s.pronta();

  // niente ricariche a catena: un'altra versione entro un minuto arriva alla prossima apertura, già dalla copia
  s.versione = "D"; await page.reload(); await s.pronta();
  assert.ok(await inCopia("D")); await attesa(500);
  assert.equal(await vers(), "C", "seconda versione entro un minuto: nessuna ricarica automatica");
  nav = []; await page.reload(); await s.pronta();
  assert.equal(await vers(), "D"); assert.deepEqual(nav, ["copia"]);

  // con una finestra aperta nessuna ricarica, nemmeno al ritorno sull'app
  await page.evaluate(() => sessionStorage.removeItem("ricaricata"));
  s.versione = "E"; s.ritardo = 2000; await page.reload(); await s.pronta(); await tocca();
  assert.ok(await inCopia("E")); s.ritardo = 0; await attesa(300);
  await page.evaluate(() => { document.querySelector(".sheet").hidden = false; });
  await visibile("hidden"); await visibile("visible"); await attesa(1000);
  assert.equal(await vers(), "D", "con una finestra aperta non si ricarica");

  // senza rete: si apre lo stesso dalla copia
  s.giu = true; nav = []; t0 = Date.now(); await page.reload(); await s.pronta(); s.giu = false;
  assert.deepEqual(nav, ["copia"], "senza rete dalla copia"); assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(s.errori, [], "nessun errore e dati mai dalla copia");
});

test("risposte compresse lette dall'app; se la compressione non arriva bene riprova in chiaro (e la spegne se è colpa sua)", async (t) => {
  const s = await sito(t), page = s.page;
  await page.goto(s.url); await s.pronta();
  const code = await page.evaluate(() => localStorage.getItem("giardino:net:code"));
  const scrivi = (b) => dati(new Request("http://x/api/dati", { method: "POST", headers: { "x-giardino-code": code, "content-type": "application/json" }, body: JSON.stringify(b) }));
  const nelTelefono = () => page.evaluate(() => JSON.parse(localStorage.getItem("giardino:net:cache") || "null")?.data?.eventi?.length || 0);
  const eventi = [...Array(300)].map((_, i) => ({ id: "e" + i, plantId: "bas", tipo: "fatto", data: "2026-10-01", litri: 0.3 }));
  await scrivi({ changes: { plants: [{ id: "bas", nome: "Basilico", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 2, num: 1, luce: 8, dove: "aperto" }] }, add: eventi });

  s.api.length = 0; await page.evaluate(() => GiardinoNet.aggiorna(false));
  assert.deepEqual(s.api, ["GET gzip"], "i dati nuovi arrivano compressi");
  assert.equal(await nelTelefono(), 300, "e l'app li legge");

  // un proxy rovina la compressione: l'app non prende per buona la risposta illeggibile, riprova subito in chiaro e se lo ricorda
  await scrivi({ add: [{ id: "e300", plantId: "bas", tipo: "fatto", data: "2026-10-02" }] });
  s.rovina = 1; s.api.length = 0; await page.evaluate(() => GiardinoNet.aggiorna(false));
  assert.deepEqual(s.api, ["GET rovinata", "GET chiaro"]);
  assert.equal(await nelTelefono(), 301, "dati giusti dalla risposta in chiaro");
  await scrivi({ add: [{ id: "e301", plantId: "bas", tipo: "fatto", data: "2026-10-03" }] });
  s.api.length = 0; await page.evaluate(() => GiardinoNet.aggiorna(false));
  assert.deepEqual(s.api, ["GET chiaro"], "per una settimana le chiede in chiaro");
  assert.equal(await nelTelefono(), 302);

  // la compressione fallisce in rete (il browser non la decodifica): riprova in chiaro; un errore solo non la spegne
  // (può essere un attimo senza rete), due di fila sì
  const inChiaro = () => page.evaluate(() => !!localStorage.getItem("giardino:net:inChiaro"));
  const ancora = async (id, guasta) => { await scrivi({ add: [{ id, plantId: "bas", tipo: "fatto", data: "2026-10-04" }] }); s.guasta = guasta; s.api.length = 0; await page.evaluate(() => GiardinoNet.aggiorna(false)); };
  await page.evaluate(() => localStorage.removeItem("giardino:net:inChiaro"));
  await ancora("e302", 1);
  assert.deepEqual(s.api, ["GET guasta", "GET chiaro"]); assert.equal(await nelTelefono(), 303); assert.equal(await inChiaro(), false, "un errore solo non la spegne");
  await ancora("e303", 0);
  assert.deepEqual(s.api, ["GET gzip"], "la volta dopo di nuovo compressa, e il conto degli errori riparte");
  await ancora("e304", 1); assert.equal(await inChiaro(), false);
  await ancora("e305", 1); assert.equal(await inChiaro(), true, "due errori di fila: in chiaro per una settimana");
  assert.equal(await nelTelefono(), 306);
  assert.deepEqual(s.errori, []);
});
