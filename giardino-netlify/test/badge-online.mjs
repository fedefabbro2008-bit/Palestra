// Giardino · prova informativa: com'è fatto il badge «Powered by Netlify» sul sito online (dove sta, quanto è grande).
const { chromium } = await import("playwright");
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); await page.goto("https://giardino-fede.netlify.app/", { waitUntil: "networkidle" }); await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const out = [];
  const visita = (root, via) => { for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) visita(el.shadowRoot, via + " > " + el.tagName + "#shadow");
    const t = (el.textContent || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("href") || "") + " " + (el.getAttribute("src") || "");
    const st = getComputedStyle(el);
    if (/netlify/i.test(t) && (st.position === "fixed" || el.tagName === "IFRAME" || /badge/i.test(el.className + el.id))) {
      const r = el.getBoundingClientRect();
      out.push({ via, tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 120), pos: st.position, z: st.zIndex, right: st.right, bottom: st.bottom, rect: [r.x, r.y, r.width, r.height].map(Math.round), html: el.outerHTML.slice(0, 500) });
    } } };
  visita(document, "document");
  return { out: out.slice(0, 8), ultimi: [...document.body.children].map((e) => e.tagName + "#" + e.id + "." + String(e.className).slice(0, 40)).slice(-6),
    script: [...document.scripts].map((s) => s.src || "(inline) " + s.textContent.slice(0, 80)).filter((s) => /netlify|inline\) .*netlify/i.test(s)), iframes: [...document.querySelectorAll("iframe")].map((f) => f.src) };
});
console.log(JSON.stringify(info, null, 1).slice(0, 7000));
const fine = (await (await fetch("https://giardino-fede.netlify.app/")).text()).slice(-1500);
console.log("FINE DELLA PAGINA SERVITA:", fine.replace(/\s+/g, " "));
await b.close();
