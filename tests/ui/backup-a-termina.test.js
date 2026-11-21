// il backup fatto a Termina (storico riusato dal salvataggio) è identico ai dati salvati, e si reimporta
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 6 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#startSessionBtn'); await p.waitForTimeout(400);
  for (let i = 0; i < 5; i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(80); }
  await p.click('#tbStop').catch(() => {});
  await p.click('#sessFinishBtn'); await p.waitForTimeout(400); if (await p.isVisible('#confirmOverlay.show')) await p.click('#confirmYes');
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => new Promise((res, rej) => {
    const stable = v => v === null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    const rq = indexedDB.open('palestra-backup', 1);
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => { const db = rq.result, st = db.transaction('copie', 'readonly').objectStore('copie'), all = st.getAll(), keys = st.getAllKeys();
      all.onsuccess = () => { keys.onsuccess = () => {
        const txt = all.result.map(x => typeof x === 'string' ? x : (x && (x.json || x.text || x.data)) || '').filter(Boolean).sort((a, b) => b.length - a.length)[0];
        let bk = null; try { bk = JSON.parse(txt); } catch (e) {}
        const ls = k => JSON.parse(localStorage.getItem('palestra:' + k));
        res({ keys: keys.result, ok: !!bk, type: bk && bk.type, sameLogs: bk && stable(bk.logs) === stable(ls('logs')), sameDays: bk && stable(bk.days) === stable(ls('days')),
          n: bk ? Object.values(bk.logs).flat().length : 0, nLs: Object.values(ls('logs')).flat().length, hasSettings: !!(bk && bk.settings && typeof bk.settings === 'object'), schema: bk && bk.schemaVersion, len: (txt || '').length, text: txt });
      }; };
    };
  }));
  check(r.ok && r.type === 'palestra-backup' && r.schema === 2 && r.hasSettings, `backup valido (${r.len} byte, chiavi ${JSON.stringify(r.keys)})`);
  check(r.sameLogs && r.n === r.nLs, `storico del backup identico a quello salvato (${r.n} allenamenti)`);
  check(r.sameDays, 'scheda identica');
  // si reimporta in un'app vuota
  const B = await open({ ls: {}, browser: A.browser }), q = B.page;
  await q.click('#settingsBtn'); await q.waitForTimeout(200);
  const [ch] = await Promise.all([q.waitForEvent('filechooser'), q.click('#importBtn')]);
  await ch.setFiles({ name: 'palestra-backup.json', mimeType: 'application/json', buffer: Buffer.from(r.text) }); await q.waitForTimeout(700);
  if (await q.isVisible('#confirmOverlay.show')) { await q.click('#confirmYes'); await q.waitForTimeout(500); }
  const t = await q.evaluate(() => document.getElementById('toastMsg').textContent);
  check(new RegExp('Importato: ' + r.n + ' allenamenti').test(t), 'reimportato: ' + t);
  console.log('errori', JSON.stringify(A.errors.concat(B.errors).filter(x => !/Service Worker|404/.test(x))));
  await A.browser.close();
})();
