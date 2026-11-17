// correzione dei Petto per errore sul backup reale: con l'import e all'apertura (con Annulla), una volta sola
const { open } = require('./lib');
const fs = require('fs');
const FILE = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const muscles = p => p.evaluate(() => { const l = JSON.parse(localStorage.getItem('palestra:logs')); const o = {}; Object.values(l).flat().forEach(s => s.entries.forEach(e => { if (/Streching - tricipiti|Sollevamneto|Alzate laterali ai manubri|^Kickback con manubri$|^Panca piana$/.test(e.name)) o[e.name] = e.muscle || 'Altro'; })); return o; });
const toast = p => p.evaluate(() => document.getElementById('toastMsg').textContent);
(async () => {
  // 1. import
  const A = await open({ ls: {} }), p = A.page;
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#importBtn')]);
  await ch.setFiles(FILE); await p.waitForTimeout(800);
  if (await p.isVisible('#confirmOverlay.show')) { await p.click('#confirmYes'); await p.waitForTimeout(600); }
  console.log('import:', await toast(p));
  const m1 = await muscles(p);
  console.log(JSON.stringify(m1));
  check(/4 muscoli corretti/.test(await toast(p)), 'import: avvisa dei 4 muscoli corretti');
  check(m1['Streching - tricipiti'] === 'Altro' && m1['Sollevamneto gambe'] === 'Addominali' && m1['Alzate laterali ai manubri'] === 'Spalle' && m1['Kickback con manubri'] === 'Tricipiti' && m1['Panca piana'] === 'Petto', 'i quattro corretti, Panca piana resta Petto');
  await p.reload(); await p.waitForTimeout(2000);
  check(!/corretti/i.test(await toast(p)), 'riaperta: nessuna seconda correzione');
  await A.browser.close();
  // 2. dati già sul telefono (aggiornamento dell'app): correzione all'apertura, con Annulla
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const B = await open({ ls: { 'palestra:days': raw.days, 'palestra:logs': raw.logs, 'palestra:settings': raw.settings } }), q = B.page;
  await q.waitForTimeout(1800);
  const t = await toast(q);
  console.log('apertura:', t);
  check(/Corretti 4 esercizi/.test(t) && await q.isVisible('#toastAct'), 'all\'apertura: avviso con Annulla');
  check((await muscles(q))['Kickback con manubri'] === 'Tricipiti', 'corretti all\'apertura');
  await q.click('#toastAct'); await q.waitForTimeout(400);
  check((await muscles(q))['Kickback con manubri'] === 'Petto' && /com'erano/.test(await toast(q)), 'Annulla: tornano com\'erano');
  await q.reload(); await q.waitForTimeout(1800);
  check((await muscles(q))['Kickback con manubri'] === 'Petto', 'dopo Annulla non si ricorregge alla riapertura');
  console.log('errori', JSON.stringify(B.errors.filter(x => !/Service Worker|404/.test(x))));
  await B.browser.close();
})();
