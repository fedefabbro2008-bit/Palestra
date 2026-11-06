// Giardino · prova informativa: il badge «Powered by Netlify» (iframe #nl-badge-frame) sul sito online:
// posizione e stile, e se resta dove lo mettiamo noi con il CSS dell'app.
const { chromium } = await import("playwright");
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); await page.goto("https://giardino-fede.netlify.app/", { waitUntil: "networkidle" }); await page.waitForTimeout(5000);
const misura = () => page.evaluate(() => {
  const f = document.getElementById("nl-badge-frame"); if (!f) return null;
  const r = f.getBoundingClientRect(), st = getComputedStyle(f);
  let dentro = null; try { const d = f.contentDocument; dentro = d ? d.body?.innerHTML.slice(0, 600) : "inaccessibile"; } catch (e) { dentro = "errore " + e.message; }
  return { rect: [r.x, r.y, r.width, r.height].map(Math.round), style: f.getAttribute("style"), pos: st.position, left: st.left, right: st.right, bottom: st.bottom, top: st.top, width: st.width, height: st.height, z: st.zIndex, attrs: [...f.attributes].map((a) => a.name + "=" + a.value.slice(0, 80)), dentro,
    tabs: (() => { const t = document.querySelector("nav.tabs"); if (!t) return null; const q = t.getBoundingClientRect(); return [q.x, q.y, q.width, q.height].map(Math.round); })() };
});
console.log("PRIMA", JSON.stringify(misura && await misura(), null, 1));
await page.addStyleTag({ content: "#nl-badge-frame{left:50% !important;right:auto !important;transform:translateX(-50%) !important;bottom:4px !important}" });
await page.waitForTimeout(500); console.log("CON IL NOSTRO CSS", JSON.stringify(await misura()));
await page.waitForTimeout(4000); console.log("4 s DOPO", JSON.stringify(await misura()));
await page.setViewportSize({ width: 320, height: 640 }); await page.waitForTimeout(800); console.log("A 320 px", JSON.stringify(await misura()));
await b.close();
