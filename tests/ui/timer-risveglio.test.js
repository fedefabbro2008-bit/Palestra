// recupero in corso e schermo spento: iPhone ferma le animazioni della pagina. Al risveglio la barra del timer (e
// l'anello, se la finestra è aperta) deve stare al punto giusto del tempo passato, non dove si era fermata
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.click('#startSessionBtn'); await p.waitForTimeout(500);
  // serie spuntate finché parte un recupero (i riscaldamenti in cima possono non averlo)
  for (let i = 0; i < 10 && !(await p.evaluate(() => document.getElementById('timerBar').classList.contains('show'))); i++) { await p.click('.sess-set-row.next .check'); await p.waitForTimeout(300); }
  await p.waitForTimeout(400);
  const read = () => p.evaluate(() => {
    const bar = document.getElementById('tbProg'), m = new DOMMatrix(getComputedStyle(bar).transform);
    const t = JSON.parse(localStorage.getItem('palestra:timer') || 'null') || {};
    return { shown: document.getElementById('timerBar').classList.contains('show'), scale: m.a, endAt: t.endAt, duration: t.duration };
  });
  const r0 = await read();
  check(r0.shown && r0.endAt && r0.duration > 10, `recupero partito (${r0.duration} s)`);
  // schermo spento: le animazioni della pagina si fermano (come su iPhone) mentre il tempo passa
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
    document.getAnimations().forEach((a) => a.pause()); });
  await p.waitForTimeout(4000);
  const stuck = await read();
  // risveglio
  await p.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(300);
  const r1 = await read();
  const want = Math.min(1, 1 - (r1.endAt - Date.now()) / 1000 / r1.duration);
  check(Math.abs(r1.scale - want) < 0.03 && r1.scale - stuck.scale > 0.03, `al risveglio la barra è al punto giusto (${r1.scale.toFixed(3)}, atteso ${want.toFixed(3)}; ferma era a ${stuck.scale.toFixed(3)})`);
  // e continua a scorrere
  await p.waitForTimeout(1500);
  const r2 = await read();
  check(r2.scale > r1.scale + 0.01, `poi continua a scorrere (${r1.scale.toFixed(3)} → ${r2.scale.toFixed(3)})`);
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
