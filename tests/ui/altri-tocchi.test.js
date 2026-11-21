// «Altri allenamenti»: niente parte per sbaglio e quello che serve si vede.
// - «Nuova giornata» viene prima, l'allenamento libero è in fondo, col triangolo «Inizia» e la scritta che parte subito;
// - un tocco nella zona appena aperta (che si sta ancora muovendo) non vale;
// - l'allenamento libero parte solo quando scegli il primo esercizio (dall'elenco, con Invio o con un nome scritto a mano):
//   prima c'è solo l'elenco sopra la schermata di oggi, e chiudendolo non è partito niente;
// - «+ Giornata» non avvia mai un allenamento, nemmeno scegliendo un esercizio, e Annulla lascia la zona aperta;
// - su uno schermo basso (come l'anteprima nell'app di Claude, 390×655) aprendo la zona la pagina scorre da sola:
//   prima la zona si apriva sotto la barra in basso e «+ Giornata» non si vedeva (scorreva la finestra, che è ferma)
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.waitForTimeout(500);
  const sess = () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:session') || 'null'); return { ls: !!s, names: s ? s.exercises.map((e) => e.name) : [], view: document.getElementById('sessionView').style.display === 'block', plan: document.getElementById('planView').style.display !== 'none' }; });
  const cancelSession = async () => { await p.click('#sessCancelBtn'); await p.waitForTimeout(250); await p.click('#confirmYes'); await p.waitForTimeout(400); };
  const openMore = async () => { if (await p.evaluate(() => document.getElementById('moreArea').hidden)) { await p.tap('#moreBtn'); await p.waitForTimeout(500); } };
  // ordine e aspetto
  const lay = await p.evaluate(() => { const secs = [...document.querySelectorAll('#moreArea .more-sec')]; const at = (sel) => secs.findIndex((s) => s.querySelector(sel)); const f = document.getElementById('freeOpenBtn');
    return { main: at('#newMainDayBtn'), free: at('#freeOpenBtn'), last: at('#freeOpenBtn') === secs.length - 1, icon: !!f.querySelector('.dp-key svg.ic.solid'), txt: f.textContent.replace(/\s+/g, ' ').trim(), head: secs[at('#freeOpenBtn')].querySelector('.more-h').textContent }; });
  check(lay.main >= 0 && lay.free > lay.main && lay.last && lay.icon && /Inizia/.test(lay.txt) && /parte/.test(lay.txt + lay.head), `allenamento libero in fondo, dopo «Nuova giornata», col triangolo e «parte subito» («${lay.txt}» · ${lay.head})`);
  // tocco subito dopo l'apertura animata: non vale (p.tap aspetterebbe la fine dell'animazione: qui il dito tocca subito)
  await p.tap('#moreBtn');
  const bb = await p.evaluate(() => { const r = document.getElementById('freeOpenBtn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(bb.x, bb.y);
  await p.waitForTimeout(300);
  const s1 = await sess(), sh1 = await p.evaluate(() => document.getElementById('subSheet').classList.contains('show'));
  check(!s1.ls && !sh1, 'tocco sull\'allenamento libero mentre la zona si apre: non parte nulla');

  // allenamento libero: prima l'elenco, nessun allenamento; chiuso senza scegliere, niente
  await p.waitForTimeout(400); await p.tap('#freeOpenBtn'); await p.waitForTimeout(400);
  const pk = await p.evaluate(() => ({ title: document.getElementById('subSheetTitle').textContent, sub: document.getElementById('subSheetSub').textContent, note: document.getElementById('subNote').textContent, show: document.getElementById('subSheet').classList.contains('show') }));
  const s2 = await sess();
  check(pk.show && !s2.ls && !s2.view && s2.plan && /parte quando scegli il primo/.test(pk.sub) && /non parte niente/.test(pk.note), `libero: si apre l'elenco («${pk.sub}»), nessun allenamento finché non scegli`);
  await p.tap('#subSheetClose'); await p.waitForTimeout(400);
  const s3 = await sess();
  check(!s3.ls && s3.plan && !s3.view, 'chiuso senza scegliere: nessun allenamento');
  // i tre modi di scegliere il primo esercizio: ognuno fa partire l'allenamento con quell'esercizio
  await openMore(); await p.tap('#freeOpenBtn'); await p.waitForTimeout(400);
  const first = await p.textContent('#subList .sub-opt .so-name');
  await p.tap('#subList .sub-opt >> nth=0'); await p.waitForTimeout(500);
  const s4 = await sess();
  check(s4.ls && s4.view && s4.names.length === 1 && s4.names[0] === first, `scelto dall'elenco: parte con «${first}»`);
  await cancelSession();
  await openMore(); await p.tap('#freeOpenBtn'); await p.waitForTimeout(400);
  await p.fill('#subSearch', 'trazioni presa neutra'); await p.waitForTimeout(150);
  const one = await p.evaluate(() => [...document.querySelectorAll('#subList .sub-opt:not([hidden]) .so-name')].map((x) => x.textContent));
  await p.press('#subSearch', 'Enter'); await p.waitForTimeout(500);
  const s5 = await sess();
  check(one.length === 1 && s5.ls && s5.names.length === 1 && s5.names[0] === one[0], `con Invio (un risultato): parte con «${one[0]}»`);
  await cancelSession();
  await openMore(); await p.tap('#freeOpenBtn'); await p.waitForTimeout(400);
  await p.fill('#subSearch', 'Esercizio inventato per la prova'); await p.waitForTimeout(150); await p.tap('#subUseBtn'); await p.waitForTimeout(500);
  const s6 = await sess();
  check(s6.ls && s6.names.length === 1 && s6.names[0] === 'Esercizio inventato per la prova', 'nome scritto a mano («Usa»): parte con quello');
  const eta = await p.textContent('#sessEta');
  check(!/Tutte le serie fatte/.test(eta), 'barra dell\'allenamento appena partito: ' + eta.trim());
  await cancelSession();

  // «+ Giornata» → selettore → esercizio: nessun allenamento; Annulla: la zona resta aperta com'era
  await openMore(); await p.tap('#newMainDayBtn'); await p.waitForTimeout(500);
  await p.tap('#ndAddBtn'); await p.waitForTimeout(400);
  const sub = await p.textContent('#subSheetSub');
  await p.tap('#subList .sub-opt >> nth=0'); await p.waitForTimeout(400);
  const s7 = await sess(), nd = await p.evaluate(() => ({ open: document.getElementById('newDaySheet').classList.contains('show'), n: document.querySelectorAll('#ndList .nd-ex').length }));
  check(!s7.ls && nd.open && nd.n === 1 && !/Allenamento libero/.test(sub), `«+ Giornata» e un esercizio scelto: resta la programmazione (${nd.n} esercizio, sottotitolo «${sub}»), nessun allenamento`);
  await p.tap('#ndCancel'); await p.waitForTimeout(300); await p.tap('#confirmYes'); await p.waitForTimeout(400);
  const back = await p.evaluate(() => ({ sheet: document.getElementById('newDaySheet').classList.contains('show'), area: !document.getElementById('moreArea').hidden }));
  check(!back.sheet && back.area, 'Annulla: si torna alla zona «Altri allenamenti» ancora aperta');
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));

  // schermo basso: aprendo, la pagina scorre da sola (con e senza animazioni)
  for (const [w, h, motion] of [[390, 655, true], [390, 655, false], [375, 667, true]]) {
    const B = await open({ browser: A.browser, ls: {}, motion, w, h }), q = B.page;
    await q.waitForTimeout(300);
    await q.tap('#moreBtn'); await q.waitForTimeout(900);
    const r = await q.evaluate(() => { const m = document.querySelector('main'), top = document.querySelector('header').getBoundingClientRect().bottom, nav = document.querySelector('nav.bottom').getBoundingClientRect().top;
      const b = document.getElementById('moreBtn').getBoundingClientRect(), g = document.getElementById('newMainDayBtn').getBoundingClientRect();
      return { scroll: Math.round(m.scrollTop), btnTop: Math.round(b.top), head: Math.round(top), gBot: Math.round(g.bottom), nav: Math.round(nav) }; });
    const tag = `${w}×${h}${motion ? '' : ' senza animazioni'}`;
    check(r.scroll > 60 && r.btnTop >= r.head && r.btnTop < r.head + 60, `${tag}: la pagina scorre da sola (${r.scroll} px), «Altri allenamenti» sale sotto l'intestazione (${r.btnTop} px)`);
    if (h >= 667) check(r.gBot <= r.nav, `${tag}: «+ Giornata» tutto sopra la barra in basso (${r.gBot} ≤ ${r.nav})`);
    await B.ctx.close();
  }
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
