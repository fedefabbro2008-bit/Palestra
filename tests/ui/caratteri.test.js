// caratteri in file a parte (fonts/): ogni @font-face punta a un file che esiste, col nome che contiene l'impronta del
// contenuto; sw.js li elenca tutti, li salva all'installazione e li serve senza rete (tutti i 7 pesi, anche quelli
// non usati nella prima schermata); il server li manda come woff2
const { open, BASE } = require('./lib');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const faces = [...html.matchAll(/@font-face\{font-family:'([^']+)';[^}]*font-weight:(\d+);[^}]*src:url\(([^)]+)\)/g)].map(m => ({ fam: m[1], wt: m[2], url: m[3] }));
  check(faces.length === 7, `7 caratteri dichiarati (${faces.map(f => f.fam + ' ' + f.wt).join(', ')})`);
  check(!/data:font\/woff2;base64/.test(html), 'nessun carattere più dentro la pagina');
  check(faces.every(f => /^fonts\/[a-z-]+-\d{3}\.[0-9a-f]{8}\.woff2$/.test(f.url)), 'nomi dei file con l\'impronta');
  const badHash = faces.filter(f => { const p = path.join(ROOT, f.url); if (!fs.existsSync(p)) return true; const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 8); return !f.url.includes('.' + h + '.'); });
  check(!badHash.length, 'ogni file esiste e l\'impronta nel nome corrisponde al contenuto ' + badHash.map(f => f.url).join(' '));
  const listed = (sw.match(/const FONTS = \[([^\]]*)\]/) || [, ''])[1].match(/fonts\/[^']+/g) || [];
  check(listed.length === faces.length && faces.every(f => listed.includes(f.url)), 'sw.js elenca esattamente i caratteri della pagina');
  const onDisk = fs.readdirSync(path.join(ROOT, 'fonts'));
  check(onDisk.length === faces.length, `in fonts/ nessun file avanzato (${onDisk.length})`);
  // il server li manda come woff2
  const heads = await Promise.all(faces.map(f => fetch(BASE + f.url).then(r => [r.status, r.headers.get('content-type')])));
  check(heads.every(([s, t]) => s === 200 && /woff2/.test(t)), 'il server li manda (200, font/woff2)');

  // nel browser: salvati all'installazione, poi tutti disponibili senza rete
  const A = await open({ ls: {}, sw: true, wait: 1500 }), p = A.page;
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cached = await p.evaluate(async list => { const c = await caches.open('palestra-v1'); const r = []; for (const u of list) r.push(!!(await c.match(u))); return r; }, faces.map(f => BASE + f.url));
  check(cached.every(Boolean), `tutti salvati dal service worker all'installazione (${cached.filter(Boolean).length}/${faces.length})`);
  await p.reload(); await p.waitForTimeout(600);
  await A.ctx.setOffline(true);
  await p.reload(); await p.waitForTimeout(800);
  const loaded = await p.evaluate(async faces => {
    const out = [];
    for (const f of faces) { const r = await document.fonts.load(`${f.wt} 16px "${f.fam}"`).catch(() => []); out.push(r.length > 0 && [...document.fonts].some(x => x.family.replace(/"/g, '') === f.fam && String(x.weight) === f.wt && x.status === 'loaded')); }
    return out;
  }, faces);
  check(loaded.every(Boolean), `senza rete si caricano tutti i 7 pesi (${loaded.filter(Boolean).length}/7)`);
  const h1 = await p.evaluate(() => getComputedStyle(document.querySelector('h1, .brand, header')).fontFamily);
  check(/Space Grotesk|Inter/.test(h1), 'l\'intestazione usa i caratteri dell\'app: ' + h1);
  await A.ctx.setOffline(false);
  const errs = A.errors.filter(e => !/404|ERR_INTERNET_DISCONNECTED|net::/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join('|'));
  await A.browser.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
