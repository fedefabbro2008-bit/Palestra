// riquadro «Claude ha modificato la scheda» in tema chiaro: compare all'avvio, senza errori
// riquadro di Claude in tema chiaro, a 390 px (dati finti nel formato dell'app)
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(() => {
    function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
    function hsh(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + str.length.toString(36); }
    const days = JSON.parse(localStorage.getItem('palestra:days'));
    localStorage.setItem('palestra:claude', JSON.stringify({ at: Date.now() - 12 * 60000, why: 'Lat machine ferma da 3 sedute: più carico e meno ripetizioni', lines: ['Lunedì: «Lat machine · presa neutra» serie 3 → 4, ripetizioni 8-12 → 6-10, kg 0 → 55', 'Mercoledì: tolto «Pec deck»'], before: days, after: hsh(stableStr(days)) }));
    const s = JSON.parse(localStorage.getItem('palestra:settings') || '{}'); s.dark = false; localStorage.setItem('palestra:settings', JSON.stringify(s));
  });
  await p.reload(); await p.waitForTimeout(600);
  const shown = await p.evaluate(() => !!document.querySelector('#claudeCard .claude-card'));
  await p.locator('#claudeCard').screenshot({ path: process.argv[2] + '/c4-chiaro.png' });
  await p.screenshot({ path: process.argv[2] + '/c5-schermata.png' });
  const er = A.errors.filter(x => !/Service Worker|404/.test(x)); check(shown && /light/.test(await p.evaluate(() => document.body.className)) && !er.length, 'riquadro di Claude in tema chiaro, nessun errore');
  await A.browser.close();
})();
