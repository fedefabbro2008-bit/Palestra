// «Altri allenamenti»: l'allenamento libero non si avvia per sbaglio. «Nuova giornata» viene prima, l'allenamento
// libero è in fondo, con il triangolo «Inizia» e la scritta che parte subito; un tocco nella zona appena aperta (che si
// sta ancora muovendo) non vale; il selettore del libero dice che parte col primo esercizio e chiudendolo non parte nulla;
// «+ Giornata» non avvia mai un allenamento, nemmeno scegliendo un esercizio
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.waitForTimeout(500);
  const sess = () => p.evaluate(() => ({ ls: !!localStorage.getItem('palestra:session'), view: document.body.classList.contains('in-session') || !!(document.getElementById('sessionView') && document.getElementById('sessionView').offsetParent) }));
  // ordine e aspetto
  const lay = await p.evaluate(() => { const secs = [...document.querySelectorAll('#moreArea .more-sec')]; const at = (sel) => secs.findIndex((s) => s.querySelector(sel)); const f = document.getElementById('freeOpenBtn');
    return { main: at('#newMainDayBtn'), free: at('#freeOpenBtn'), last: at('#freeOpenBtn') === secs.length - 1, icon: !!f.querySelector('.dp-key svg.ic.solid'), txt: f.textContent.replace(/\s+/g, ' ').trim(), head: secs[at('#freeOpenBtn')].querySelector('.more-h').textContent }; });
  check(lay.main >= 0 && lay.free > lay.main && lay.last && lay.icon && /Inizia/.test(lay.txt) && /parte/.test(lay.txt + lay.head), `allenamento libero in fondo, dopo «Nuova giornata», col triangolo e «parte subito» («${lay.txt}» · ${lay.head})`);
  // tocco subito dopo l'apertura animata: non vale
  // (p.tap aspetterebbe la fine dell'animazione: qui il dito tocca subito dove si vede il pulsante)
  await p.tap('#moreBtn');
  const bb = await p.evaluate(() => { const r = document.getElementById('freeOpenBtn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: performance.now() - (document.getElementById('moreArea')._lockUntil - 350) }; });
  await p.touchscreen.tap(bb.x, bb.y);
  await p.waitForTimeout(300);
  const s1 = await sess(), sh1 = await p.evaluate(() => document.getElementById('subSheet').classList.contains('show'));
  check(!s1.ls && !sh1, 'tocco sull\'allenamento libero mentre la zona si apre: non parte nulla');
  // a zona ferma il tocco vale: selettore con la spiegazione; chiuso senza scegliere, nessun allenamento
  await p.waitForTimeout(400); await p.tap('#freeOpenBtn'); await p.waitForTimeout(400);
  const note = await p.textContent('#subNote');
  check(/parte con il primo esercizio/.test(note) && /Chiudi senza sceglierne/.test(note), 'selettore del libero: «' + note + '»');
  await p.tap('#subSheetClose'); await p.waitForTimeout(400);
  const s2b = await sess();
  check(!s2b.ls, 'chiuso senza scegliere: nessun allenamento');
  // «+ Giornata» → selettore → esercizio: nessun allenamento
  await p.evaluate(() => { if (document.getElementById('moreArea').hidden) document.getElementById('moreBtn').click(); });
  await p.waitForTimeout(500); await p.tap('#newMainDayBtn'); await p.waitForTimeout(500);
  await p.tap('#ndAddBtn'); await p.waitForTimeout(400);
  const sub = await p.textContent('#subSheetSub');
  await p.tap('#subList .sub-opt >> nth=0'); await p.waitForTimeout(400);
  const s3 = await sess(), nd = await p.evaluate(() => ({ open: document.getElementById('newDaySheet').classList.contains('show'), n: document.querySelectorAll('#ndList .nd-ex').length }));
  check(!s3.ls && nd.open && nd.n === 1 && !/Allenamento libero/.test(sub), `«+ Giornata» e un esercizio scelto: resta la programmazione (${nd.n} esercizio, sottotitolo «${sub}»), nessun allenamento`);
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
