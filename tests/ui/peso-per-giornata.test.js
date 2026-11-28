// Peso totale per giornata sui dati reali: riserve distinguibili, confronto anche con una seduta "strana" in passato
const { open, tab } = require('./lib');
const FILE = process.argv[2], OUT = process.argv[3];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#importBtn')]);
  await ch.setFiles(FILE); await p.waitForTimeout(800);
  if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(600); }
  await p.click('#settingsClose'); await tab(p, 'stats'); await p.waitForTimeout(400);
  const opts = await p.$$eval('#dayTonPicker option', l => l.map(o => o.value + '=' + o.textContent));
  console.log('menu:', opts.join(' | '));
  check(opts.some(o => /^R=Riserva · Palestra/.test(o)) && opts.some(o => /^S=Riserva · Casa/.test(o)), 'le due riserve si distinguono');
  await p.selectOption('#dayTonPicker', 'S'); await p.waitForTimeout(400);
  const chart = (await p.textContent('#dayTonChart')).replace(/\s+/g, ' ');
  const info = (await p.textContent('#dayTonInfo')).replace(/\s+/g, ' ');
  console.log('grafico S:', chart.slice(0, 160)); console.log('spiegazione:', info.slice(-260));
  check(!/Nessun esercizio in comune/.test(chart) && (await p.$$('#dayTonChart .dt-bar')).length === 2, 'Riserva · Casa: confronto fra le 2 sedute recenti');
  check(/seduta più vecchia è esclusa/.test(info), 'spiega che la seduta del 02/10 è esclusa');
  for (const k of ['A', 'B']) { await p.selectOption('#dayTonPicker', k); await p.waitForTimeout(300); console.log(k, (await p.$$('#dayTonChart .dt-bar')).length, 'sedute ·', (await p.textContent('#dayTonInfo')).replace(/\s+/g, ' ').match(/Calcolato su[^.]*/)[0].slice(0, 120)); }
  await p.selectOption('#dayTonPicker', 'S'); await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('dayTonChart').closest('.card').scrollIntoView({ block: 'start' }));
  await p.locator('#dayTonChart >> xpath=ancestor::div[contains(@class,"card")][1]').screenshot({ path: OUT + '/r3-giornata.png' });
  console.log('errori', JSON.stringify(A.errors.filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
