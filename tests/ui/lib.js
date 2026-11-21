const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8888/';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
async function open(opts = {}) {
  const browser = opts.browser || await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: opts.w || 390, height: opts.h || 844 }, deviceScaleFactor: opts.dpr || 2,
    isMobile: true, hasTouch: true, userAgent: opts.android ? ANDROID_UA : IPHONE_UA,
    reducedMotion: opts.motion ? 'no-preference' : 'reduce', serviceWorkers: opts.sw ? 'allow' : 'block',
    timezoneId: 'Europe/Rome', locale: 'it-IT',
  });
  if (opts.now) await ctx.addInitScript(`(()=>{ const off = ${opts.now} - Date.now(); const D = Date; class FD extends D { constructor(...a){ if(!a.length) super(D.now()+off); else super(...a); } static now(){ return D.now()+off; } } window.Date = FD; })();`);
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  if (opts.ls) {
    await page.goto(BASE + '__blank__', { waitUntil: 'commit' }).catch(()=>{});
    await page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem(k, typeof ls[k] === 'string' ? ls[k] : JSON.stringify(ls[k])); }, opts.ls);
  }
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'load' });
  await page.waitForTimeout(opts.wait || 400);
  return { browser, ctx, page, errors };
}
async function tab(page, t) { await page.click(`nav.bottom button[data-tab="${t}"]`); await page.waitForTimeout(250); }
async function full(page, file) {
  // screenshot dell'intero contenuto di <main> (che scorre da solo): si allunga la finestra
  const h = await page.evaluate(() => { const m = document.querySelector('main'); return m.scrollHeight + (document.querySelector('header').offsetHeight||0) + document.querySelector('.bottom-stack').offsetHeight + 40; });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(h, 12000) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: file });
  await page.setViewportSize(vp);
}
module.exports = { open, tab, full, BASE };
