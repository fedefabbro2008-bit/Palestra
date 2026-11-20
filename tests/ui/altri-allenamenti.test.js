// «Altri allenamenti» nella scheda di oggi: un pulsante che allunga la zona (non apre una finestra) con le versioni corte,
// l'allenamento libero e «Nuova giornata» (normale o versione corta). Aprendo, quello che sta sotto scende solo con
// transform e la zona compare con opacità; scelta una versione corta si richiude e il pulsante dice quale; le giornate
// nuove si creano, diventano quella scelta e si apre la modifica col nome pronto; senza animazioni si apre e basta
const { open } = require('./lib');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  for (const motion of [true, false]) {
    const tag = motion ? '' : '[senza animazioni] ';
    const A = await open({ ls: {}, motion }), p = A.page;
    await p.waitForTimeout(500);
    const st = () => p.evaluate(() => ({ exp: document.getElementById('moreBtn').getAttribute('aria-expanded'), hidden: document.getElementById('moreArea').hidden,
      sheet: !!document.getElementById('spareSheet'), old: !!document.getElementById('spareOpenBtn'), freeVis: !!document.getElementById('freeOpenBtn').offsetParent,
      btn: document.getElementById('moreBtn').textContent.replace(/\s+/g, ' ').trim(), start: document.getElementById('startSessionBtn').getBoundingClientRect().top - document.getElementById('todayCard').getBoundingClientRect().top }));
    let s0 = await st();
    check(s0.exp === 'false' && s0.hidden && !s0.freeVis && !s0.sheet && !s0.old && /Altri allenamenti/.test(s0.btn), tag + 'chiuso: un pulsante «Altri allenamenti», niente righe a parte né finestra delle riserve (' + s0.btn + ')');
    if (motion) await p.locator('#todayCard').screenshot({ path: OUT + '/chiuso.png' });
    // apre: la zona c'è, il pulsante Inizia scende con transform, la zona compare con opacità (niente altezze animate)
    await p.evaluate(() => { window.__an = []; const b = document.getElementById('startSessionBtn'); const poll = () => { document.getAnimations().forEach((a) => { const k = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes().flatMap((f) => Object.keys(f)).filter((x) => !/^(offset|easing|composite|computedOffset)$/.test(x)) : []; window.__an.push({ t: a.effect.target && (a.effect.target.id || a.effect.target.className), k: [...new Set(k)].join(',') }); }); if (window.__an.length < 400) requestAnimationFrame(poll); }; requestAnimationFrame(poll); });
    await p.tap('#moreBtn'); await p.waitForTimeout(600);
    let s1 = await st();
    const an = await p.evaluate(() => window.__an);
    const mine = an.filter((x) => /startSessionBtn|nextHint|statRow|moreArea/.test(String(x.t)));
    const props = [...new Set(mine.map((x) => x.k).join(',').split(',').filter(Boolean))];
    check(s1.exp === 'true' && !s1.hidden && s1.freeVis && s1.start > s0.start + 100, tag + `aperto: la zona si allunga sotto il pulsante (Inizia scende di ${Math.round(s1.start - s0.start)} px)`);
    check(motion ? (mine.some((x) => /startSessionBtn/.test(x.t)) && mine.some((x) => /moreArea/.test(x.t)) && props.every((k) => k === 'transform' || k === 'opacity')) : !mine.length, tag + (motion ? 'apertura animata solo con transform e opacità: ' + props.join(', ') : 'nessuna animazione'));
    const inside = await p.evaluate(() => ({ spare: document.querySelectorAll('#moreArea #sparePills .day-pill').length, free: !!document.querySelector('#moreArea #freeOpenBtn'), main: !!document.querySelector('#moreArea #newMainDayBtn'), sp: !!document.querySelector('#moreArea #newSpareDayBtn'), sub: document.getElementById('spareSub').textContent }));
    check(inside.spare >= 2 && inside.free && inside.main && inside.sp && /Vale come .*la giornata che tocca/.test(inside.sub), tag + `dentro: ${inside.spare} versioni corte (${inside.sub}), allenamento libero, nuova giornata normale o corta`);
    if (motion) await p.locator('#todayCard').screenshot({ path: OUT + '/aperto.png' });
    // chiude toccando di nuovo
    await p.tap('#moreBtn'); await p.waitForTimeout(500);
    let s2 = await st();
    check(s2.exp === 'false' && s2.hidden && Math.abs(s2.start - s0.start) < 1, tag + 'toccato di nuovo: si richiude e Inizia torna al suo posto');
    // sceglie una versione corta: si richiude, il pulsante dice quale, Inizia la usa
    await p.tap('#moreBtn'); await p.waitForTimeout(400);
    await p.tap('#sparePills .day-pill >> nth=0'); await p.waitForTimeout(500);
    const s3 = await st(), hint = await p.textContent('#nextHint');
    check(s3.hidden && /Allenamento corto: .+cambia/.test(s3.btn) && /Versione corta di oggi/.test(hint), tag + 'scelta una versione corta: zona chiusa, pulsante «' + s3.btn + '»');
    // nuova giornata normale: in alto, scelta, modifica aperta col nome pronto da scrivere
    const nDays = () => p.evaluate(() => { const d = JSON.parse(localStorage.getItem('palestra:days')); return { main: Object.keys(d).filter((k) => !d[k].spare).length, spare: Object.keys(d).filter((k) => d[k].spare).length, keys: Object.keys(d) }; });
    const d0 = await nDays();
    await p.tap('#moreBtn'); await p.waitForTimeout(400); await p.tap('#newMainDayBtn'); await p.waitForTimeout(700);
    const d1 = await nDays(), e1 = await p.evaluate(() => ({ edit: document.getElementById('planEditTools').style.display !== 'none', focus: document.activeElement && document.activeElement.id, name: document.getElementById('dayNameInput').value, pill: document.querySelector('#dayPills .day-pill.active .dp-key').textContent, area: document.getElementById('moreArea').hidden, spare: document.getElementById('spareToggle').checked }));
    check(d1.main === d0.main + 1 && d1.spare === d0.spare && e1.edit && e1.focus === 'dayNameInput' && /^Giorno /.test(e1.name) && e1.pill.startsWith('Giorno') && e1.area && !e1.spare, tag + `nuova giornata: ${d0.main} → ${d1.main} in alto, scelta, modifica aperta col nome «${e1.name}» pronto da scrivere`);
    await p.fill('#dayNameInput', 'Sabato · Gambe leggere'); await p.waitForTimeout(300);
    check((await p.textContent('#dayPills .day-pill.active .dp-key')) === 'Sabato', tag + 'il nome scritto compare subito in alto');
    // nuova versione corta: tra le versioni corte, interruttore «riserva» acceso
    await p.click('#planEditBtn'); await p.waitForTimeout(300);
    await p.tap('#moreBtn'); await p.waitForTimeout(400); await p.tap('#newSpareDayBtn'); await p.waitForTimeout(700);
    const d2 = await nDays(), e2 = await p.evaluate(() => ({ spare: document.getElementById('spareToggle').checked, name: document.getElementById('dayNameInput').value, focus: document.activeElement && document.activeElement.id }));
    check(d2.spare === d1.spare + 1 && d2.main === d1.main && e2.spare && /^Riserva · /.test(e2.name) && e2.focus === 'dayNameInput', tag + `nuova versione corta: ${d1.spare} → ${d2.spare}, interruttore «riserva» acceso, nome «${e2.name}»`);
    await p.click('#planEditBtn'); await p.waitForTimeout(300);
    await p.tap('#moreBtn'); await p.waitForTimeout(400);
    check(await p.evaluate(() => document.querySelectorAll('#sparePills .day-pill').length) === d2.spare, tag + 'la versione corta nuova è nell\'elenco delle versioni corte');
    const errs = A.errors.filter((e) => !/404|Service Worker/.test(e));
    check(!errs.length, tag + 'nessun errore ' + errs.join(' | '));
    await A.browser.close();
  }
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
