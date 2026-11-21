// «Nuova giornata»: prima si programma, poi si crea. Il foglio si apre senza creare niente e senza avviare un
// allenamento; gli esercizi si scelgono col selettore (anche cercando o con un nome nuovo, col suo muscolo) e
// arrivano con serie e ripetizioni della scheda o della libreria e i kg dell'ultima volta; serie, ripetizioni e kg
// si cambiano; «Crea» è spento finché non c'è un esercizio; Annulla con esercizi scelti chiede conferma e non crea
// niente; la giornata creata tiene gli id degli esercizi già fatti (storico e consigli collegati) e si può iniziare;
// il «+» in Modifica apre lo stesso foglio; Indietro chiude prima il selettore poi il foglio. La giornata creata
// va nella sua lista ma NON diventa quella scelta (nessun allenamento cambia o parte)
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const A = await open({ ls: {}, motion: true }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 6 }); await p.reload(); await p.waitForTimeout(800);
  const days = () => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:days')));
  const D0 = await days(), n0 = Object.keys(D0).length;
  const st = () => p.evaluate(() => ({ sheet: document.getElementById('newDaySheet').classList.contains('show'), picker: document.getElementById('subSheet').classList.contains('show'),
    rows: [...document.querySelectorAll('#ndList .nd-ex')].map((r) => ({ name: r.querySelector('.nd-txt b').textContent, sets: +r.querySelector('.nd-step b').textContent, reps: r.querySelector('input[data-f="reps"]').value, kg: r.querySelector('input[data-f="kg"]').value, musc: !!r.querySelector('select[data-f="muscle"]') })),
    create: document.getElementById('ndCreate').disabled, title: document.getElementById('ndTitle').textContent, session: !!localStorage.getItem('palestra:session') }));

  const before = await p.textContent('#dayPills .day-pill.active .dp-key');
  // 1. si apre la programmazione: niente creato, nessun allenamento, «Crea» spento
  await p.tap('#moreBtn'); await p.waitForTimeout(400); await p.tap('#newMainDayBtn'); await p.waitForTimeout(500);
  let s = await st();
  check(s.sheet && s.title === 'Nuova giornata' && !s.rows.length && s.create && !s.session && Object.keys(await days()).length === n0, '«Giornata»: si apre «Nuova giornata» vuota, «Crea» spento, nessuna giornata creata né allenamento avviato');

  // 2. un esercizio già fatto, dal selettore (sta sopra il foglio): serie e ripetizioni della scheda, kg dell'ultima volta
  await p.tap('#ndAddBtn'); await p.waitForTimeout(400);
  const pick = await p.evaluate(() => ({ top: document.getElementById('subSheet').classList.contains('show'), title: document.getElementById('subSheetTitle').textContent, first: document.querySelector('#subList .sub-opt .so-name').textContent }));
  check(pick.top && pick.title === 'Aggiungi esercizio', 'il selettore si apre sopra il foglio: «' + pick.title + '»');
  await p.tap('#subList .sub-opt >> nth=0'); await p.waitForTimeout(400);
  s = await st();
  const planEx = Object.values(D0).flatMap((d) => d.exercises).find((e) => e.name === pick.first);
  const lastKg = await p.evaluate((n) => { const L = JSON.parse(localStorage.getItem('palestra:logs')); const isos = Object.keys(L).sort(); for (let i = isos.length - 1; i >= 0; i--) for (const x of L[isos[i]].slice().reverse()) { const e = x.entries.find((en) => en.name === n); if (e) { const w = e.detail.filter((d) => !d.w && d.t !== 'd'); return w.length ? Math.max(...w.map((d) => d.kg || 0)) : 0; } } return null; }, pick.first);
  const fmt = (k) => k ? String(k).replace('.', ',') : '';
  check(!s.picker && s.rows.length === 1 && s.rows[0].name === pick.first && (!planEx || (s.rows[0].sets === planEx.sets && s.rows[0].reps === planEx.reps)) && s.rows[0].kg === fmt(lastKg) && !s.create,
    `aggiunto «${pick.first}»: ${s.rows[0] && s.rows[0].sets}×${s.rows[0] && s.rows[0].reps}, ${s.rows[0] && s.rows[0].kg || 0} kg (ultima volta), «Crea» acceso`);

  // 3. cercando, e un esercizio nuovo scritto a mano (col suo muscolo da scegliere); niente doppioni
  await p.tap('#ndAddBtn'); await p.waitForTimeout(300);
  check(!(await p.evaluate((n) => [...document.querySelectorAll('#subList .sub-opt .so-name')].some((x) => x.textContent === n), pick.first)), 'nel selettore non c\'è più quello già scelto');
  await p.fill('#subSearch', 'lat'); await p.waitForTimeout(200);
  const lat = await p.evaluate(() => { const b = document.querySelector('#subList .sub-opt:not([hidden]) .so-name'); return b ? b.textContent : null; });
  await p.tap('#subList .sub-opt:not([hidden]) >> nth=0'); await p.waitForTimeout(300);
  await p.tap('#ndAddBtn'); await p.waitForTimeout(300);
  await p.fill('#subSearch', 'Spinta inventata alla macchina'); await p.waitForTimeout(200); await p.tap('#subUseBtn'); await p.waitForTimeout(300);
  s = await st();
  check(s.rows.length === 3 && s.rows[1].name === lat && s.rows[2].name === 'Spinta inventata alla macchina' && s.rows[2].musc && !s.rows[0].musc, `cercando «lat»: ${lat}; esercizio nuovo con il muscolo da scegliere`);

  // 4. serie, ripetizioni, kg e muscolo si cambiano; un esercizio si toglie
  await p.tap('#ndList .nd-ex >> nth=0 >> button[data-d="1"]'); await p.tap('#ndList .nd-ex >> nth=0 >> button[data-d="1"]'); await p.tap('#ndList .nd-ex >> nth=0 >> button[data-d="-1"]');
  await p.fill('#ndList .nd-ex >> nth=2 >> input[data-f="reps"]', '10-12'); await p.fill('#ndList .nd-ex >> nth=2 >> input[data-f="kg"]', '22,5');
  await p.selectOption('#ndList .nd-ex >> nth=2 >> select[data-f="muscle"]', 'Petto'); await p.waitForTimeout(200);
  const sets0 = s.rows[0].sets;
  await p.tap('#ndList .nd-ex >> nth=1 >> .nd-del'); await p.waitForTimeout(200);
  s = await st();
  check(s.rows.length === 2 && s.rows[0].sets === sets0 + 1 && s.rows[1].reps === '10-12' && s.rows[1].kg === '22,5', `cambiati: serie ${sets0} → ${s.rows[0].sets}, «10-12» e 22,5 kg; tolto «${lat}»`);

  // 5. Annulla con esercizi scelti: chiede conferma; «Continua» resta, «Lascia» chiude senza creare niente
  await p.tap('#ndCancel'); await p.waitForTimeout(300);
  check(await p.isVisible('#confirmOverlay.show') && /non vengono salvati/.test(await p.textContent('#confirmMsg')), 'Annulla con esercizi scelti: chiede conferma');
  await p.tap('#confirmNo'); await p.waitForTimeout(300);
  check((await st()).sheet && (await st()).rows.length === 2, '«Continua»: il foglio resta com\'era');

  // 6. Crea: giornata in alto, scelta, con gli esercizi programmati (id di quello già fatto uguale alla scheda)
  await p.fill('#ndName', 'Sabato · Palestra · Prova'); await p.tap('#ndCreate'); await p.waitForTimeout(900);
  const D1 = await days(), k = Object.keys(D1).find((x) => !(x in D0)), day = D1[k];
  const pe = day && day.exercises.find((e) => e.name === pick.first), ne = day && day.exercises.find((e) => e.name === 'Spinta inventata alla macchina');
  check(!!day && !day.spare && day.name === 'Sabato · Palestra · Prova' && day.exercises.length === 2 && (!planEx || pe.id === planEx.id) && pe.sets === sets0 + 1 && ne.reps === '10-12' && ne.kg === 22.5 && ne.muscle === 'Petto' && ne.rest === 90,
    `giornata creata «${day && day.name}» con ${day && day.exercises.length} esercizi: stesso id della scheda per «${pick.first}», «Spinta inventata» Petto 3×10-12 22,5 kg, recupero 90 s`);
  const top = await p.evaluate((k) => ({ active: document.querySelector('#dayPills .day-pill.active .dp-key').textContent, mine: !!document.querySelector(`#dayPills .day-pill[data-k="${k}"]`), mineActive: !!document.querySelector(`#dayPills .day-pill.active[data-k="${k}"]`), sheet: document.getElementById('newDaySheet').classList.contains('show'), session: !!localStorage.getItem('palestra:session') }), k);
  check(top.mine && !top.mineActive && top.active === before && !top.sheet && !top.session, `la giornata nuova è in alto tra le giornate ma non scelta: resta «${top.active}», nessun allenamento avviato`);
  // scelta a mano: il riquadro Esercizi ha quelli programmati e Inizia parte con quelli
  await p.click(`#dayPills .day-pill[data-k="${k}"]`); await p.waitForTimeout(400);
  check(/2 esercizi/.test(await p.textContent('#planCount')), 'toccata la giornata nuova: ' + (await p.textContent('#planCount')));
  await p.click('#startSessionBtn'); await p.waitForTimeout(500);
  const sess = await p.evaluate(() => JSON.parse(localStorage.getItem('palestra:session') || 'null'));
  check(sess && sess.dayKey === k && sess.exercises.map((e) => e.name).join('|') === day.exercises.map((e) => e.name).join('|'), 'Inizia allenamento: parte con gli esercizi programmati');
  await p.click('#sessCancelBtn'); await p.waitForTimeout(200); await p.click('#confirmYes'); await p.waitForTimeout(400);

  // 7. Annulla senza esercizi: si chiude e basta; il «+» in Modifica apre lo stesso foglio; Indietro: prima il selettore
  await p.tap('#moreBtn'); await p.waitForTimeout(300); await p.tap('#newSpareDayBtn'); await p.waitForTimeout(400);
  check((await st()).title === 'Nuova versione corta', 'Versione corta: «Nuova versione corta»');
  await p.tap('#ndCancel'); await p.waitForTimeout(300);
  check(!(await st()).sheet && !(await p.isVisible('#confirmOverlay.show')) && Object.keys(await days()).length === n0 + 1, 'Annulla senza esercizi: si chiude senza chiedere, niente creato');
  await p.click('#planEditBtn'); await p.waitForTimeout(300);
  await p.click('#dayPills .add-day-pill'); await p.waitForTimeout(400);
  check((await st()).sheet && (await st()).title === 'Nuova giornata', 'il «+» in Modifica apre «Nuova giornata»');
  await p.tap('#ndCancel'); await p.waitForTimeout(300);
  const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  // Android, tasto Indietro: chiude prima il selettore, poi il foglio (senza uscire dall'app)
  const B = await open({ browser: A.browser, ls: {}, motion: true, android: true }), q = B.page;
  await q.tap('#moreBtn'); await q.waitForTimeout(300); await q.tap('#newMainDayBtn'); await q.waitForTimeout(400);
  await q.tap('#ndAddBtn'); await q.waitForTimeout(400);
  const shown = () => q.evaluate(() => ({ picker: document.getElementById('subSheet').classList.contains('show'), sheet: document.getElementById('newDaySheet').classList.contains('show'), url: location.href }));
  await q.goBack().catch(() => {}); await q.waitForTimeout(500);
  const b1 = await shown();
  await q.goBack().catch(() => {}); await q.waitForTimeout(500);
  const b2 = await shown();
  check(!b1.picker && b1.sheet && !b2.picker && !b2.sheet && /localhost/.test(b2.url), 'Android, Indietro: prima il selettore, poi il foglio, e si resta nell\'app');
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
