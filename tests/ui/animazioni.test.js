// animazioni: 1 timer continuo · 2 serie dopo · 6 interruttori · 7 pillola giornate · 9 numeri · 10 riquadri · 12 fiammella
const { open, tab } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  for (const motion of [true, false]) {
    const tag = motion ? '' : '[senza animazioni] ';
    const A = await open({ ls: {}, motion }), p = A.page;
    await p.evaluate(seedLogs, { weeks: 8 }); await p.reload(); await p.waitForTimeout(600);
    // 12. fiammella
    const fl = await p.evaluate(() => { const f = document.querySelector('#statsRow .flame, .stat-line .flame'); return f ? { anim: getComputedStyle(f).animationName, s: document.getElementById('statStreak').textContent } : null; });
    check(!!fl && (motion ? /flameFlick/.test(fl.anim) : fl.anim === 'none'), tag + 'fiammella accanto alle settimane di fila: ' + JSON.stringify(fl));
    if (motion) await p.locator('.stat-line').screenshot({ path: OUT + '/f-fiamma.png' });
    // 7. giornate: il bordo si sposta (vetro liquido): i due lati si muovono ognuno per conto suo (si allunga e si
    //    richiude), il bordo resta sottile e gli angoli tondi (pezzi mai scalati); le giornate restano ferme, mai fuori dal bordo
    const g = () => p.evaluate(() => { const w = document.getElementById('dayPills'), i = w.querySelector('.dp-ind').getBoundingClientRect(), a = w.querySelector('.day-pill.active').getBoundingClientRect(); return { il: Math.round(i.left), iw: Math.round(i.width), al: Math.round(a.left), aw: Math.round(a.width), has: w.classList.contains('has-ind'), sw: w.scrollWidth, cw: w.clientWidth }; });
    let d = await g(); check(d.has && Math.abs(d.il - d.al) <= 1 && Math.abs(d.iw - d.aw) <= 1, tag + 'giornate: riquadro sotto la giornata scelta ' + JSON.stringify(d));
    for (const target of [2, 0, 1]) {
      await p.evaluate(() => { window.__pills = [...document.querySelectorAll('#dayPills .day-pill')]; window.__dx = []; window.__sw = 0; window.__ww = []; window.__cw = new Set(); const f = () => { const w = document.getElementById('dayPills'), i = w.querySelector('.dp-ind .lq-l'), rr = w.querySelector('.dp-ind .lq-r').getBoundingClientRect(), ll = i.getBoundingClientRect(); window.__dx.push(ll.left); window.__ww.push(rr.right - ll.left); window.__cw.add(Math.round(ll.width * 10) + '/' + Math.round(rr.width * 10)); window.__sw = Math.max(window.__sw, getComputedStyle(w).overflowX === 'visible' ? 0 : w.scrollWidth - w.clientWidth); window.__sl = Math.max(window.__sl || 0, w.scrollLeft); if (window.__dx.length < 50) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const was = await p.evaluate(() => [...document.querySelectorAll('#dayPills .day-pill')].findIndex(b => b.classList.contains('active')));
      if (was === target) continue;
      await p.click(`#dayPills .day-pill >> nth=${target}`); await p.waitForTimeout(900);
      d = await g();
      const r = await p.evaluate(() => ({ same: [...document.querySelectorAll('#dayPills .day-pill')].every((b, i) => b === window.__pills[i]), steps: new Set(window.__dx.map(Math.round)).size, over: window.__sw + (window.__sl || 0), wid: [...new Set(window.__dx.map(Math.round))].length, maxw: Math.max(...window.__ww), caps: window.__cw.size }));
      check(Math.abs(d.il - d.al) <= 1 && Math.abs(d.iw - d.aw) <= 1 && r.same && r.over === 0 && (motion ? r.steps > 6 && r.maxw > d.aw * 1.2 && r.caps === 1 : r.steps <= 2), tag + `giornata ${was}→${target}: ` + (motion ? `il bordo si sposta (${r.steps} posizioni del lato sinistro, si allunga fino a ${Math.round(r.maxw)} px contro ${d.aw}, angoli mai deformati)` : 'salta subito') + `, giornate non ricreate, mai oltre il bordo (sporge ${r.over}px)`);
    }
    if (motion) await p.locator('#dayPills').screenshot({ path: OUT + '/f-giornate.png' });
    // 6. interruttori: premuto si allunga
    if (motion) {
      await p.click('#settingsBtn'); await p.waitForTimeout(400);
      const bb = await p.evaluate(() => { const sw = [...document.querySelectorAll('#settingsSheet .switch')].find(x => x.offsetWidth && !x.querySelector('input').disabled); sw.id = 'swProva'; sw.scrollIntoView({ block: 'center' }); const r = sw.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      await p.waitForTimeout(300);
      const bb2 = await p.evaluate(() => { const r = document.getElementById('swProva').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const was = await p.evaluate(() => document.querySelector('#swProva input').checked);
      await p.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await p.mouse.down(); await p.waitForTimeout(250);
      const w = await p.evaluate(() => document.querySelector('#swProva .knob').getBoundingClientRect().width);
      await p.mouse.up(); await p.waitForTimeout(500);
      const w2 = await p.evaluate(() => document.querySelector('#swProva .knob').getBoundingClientRect().width);
      check(w > 23 && w2 < 20, 'interruttore: premuto si allunga (' + w.toFixed(1) + ' px), lasciato torna (' + w2.toFixed(1) + ' px)');
      if (await p.evaluate(() => document.querySelector('#swProva input').checked) !== was) await p.mouse.click(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);   // rimesso com'era
      await p.waitForTimeout(400);
      await p.click('#settingsClose'); await p.waitForTimeout(300);
    }
    // 9. numeri che contano + 10. riquadri
    await p.evaluate(() => { document.querySelector('nav.bottom button[data-tab="stats"]').click(); window.__nums = []; const f = () => { const b = document.querySelector('#tab-stats .m-ring-txt b'); window.__nums.push(b ? b.textContent : ''); if (window.__nums.length < 40) requestAnimationFrame(f); }; f(); });
    await p.waitForTimeout(900);
    const nums = await p.evaluate(() => window.__nums.filter(Boolean)), fin = await p.evaluate(() => document.querySelector('#tab-stats .m-ring-txt b').textContent);
    check(motion ? new Set(nums).size > 1 && nums[0] === '0' && nums[nums.length - 1] === fin : new Set(nums).size === 1, tag + 'Settimana: il numero ' + (motion ? 'conta da 0 a ' + fin + ' (' + [...new Set(nums)].join(',') + ')' : 'è subito ' + fin));
    const ton = await p.evaluate(() => [...document.querySelectorAll('#tab-stats [data-cnt]')].map(e => e.textContent));
    await tab(p, 'month'); await tab(p, 'stats'); await p.waitForTimeout(300);
    const ton2 = await p.evaluate(() => [...document.querySelectorAll('#tab-stats [data-cnt]')].map(e => e.textContent));
    check(JSON.stringify(ton) === JSON.stringify(ton2), tag + 'valori finali giusti e non ricontati tornando: ' + ton.join(' | '));
    await tab(p, 'plan'); await p.waitForTimeout(500);
    const rv = await p.evaluate(() => document.querySelectorAll('#tab-plan .reveal').length);
    check(motion ? rv > 0 : rv === 0, tag + 'Progressi: riquadri sotto lo schermo in attesa: ' + rv);
    for (let i = 0; i < 12; i++) { await p.evaluate(() => document.querySelector('main').scrollBy(0, 500)); await p.waitForTimeout(150); }
    await p.waitForTimeout(800);
    const hidden = await p.evaluate(() => [...document.querySelectorAll('#tab-plan .card')].filter(c => getComputedStyle(c).opacity < 0.99 && c.offsetHeight).length);
    check(hidden === 0, tag + 'scorrendo fino in fondo tutti i riquadri compaiono (nascosti: ' + hidden + ')');
    await p.evaluate(() => document.querySelector('main').scrollTo(0, 0));
    // 1 e 2: allenamento, spunta, timer
    await tab(p, 'workout');
    await p.click('#startSessionBtn'); await p.waitForTimeout(700);
    const b = await p.$('.sess-set-row.next .check'); await b.click(); await p.waitForTimeout(150);
    const glow = await p.evaluate(() => { const r = document.querySelector('#sessList .sess-set-row.next'); return r ? r.classList.contains('next-glow') : null; });
    await p.waitForTimeout(400);
    const glow2 = await p.evaluate(() => { const r = document.querySelector('#sessList .sess-set-row.next'); return r ? r.classList.contains('next-glow') : null; });
    check(motion ? glow2 === true : glow2 === false, tag + 'serie successiva illuminata dopo la spunta (' + glow + '→' + glow2 + ')');
    for (let i = 0; i < 8 && !(await p.evaluate(() => document.getElementById('timerBar').classList.contains('show'))); i++) { await (await p.$('.sess-set-row.next .check')).click(); await p.waitForTimeout(400); }
    const tl = await p.evaluate(() => ({ show: document.getElementById('timerBar').classList.contains('show'), an: document.getElementById('tbProg').getAnimations().length }));
    const s1 = await p.evaluate(() => getComputedStyle(document.getElementById('tbProg')).transform);
    await p.waitForTimeout(500);
    const s2 = await p.evaluate(() => getComputedStyle(document.getElementById('tbProg')).transform);
    check(tl.show && (motion ? tl.an === 1 && s1 !== s2 : tl.an === 0), tag + 'timer: barra di avanzamento ' + (motion ? 'continua (' + s1 + ' → ' + s2 + ')' : 'a scatti'));
    if (motion) {
      await p.locator('.bottom-stack').screenshot({ path: OUT + '/f-timer.png' });
      // la serie dopo fuori dallo schermo: si scorre per mostrarla
      await p.evaluate(() => document.querySelector('main').scrollTo(0, 0)); await p.waitForTimeout(300);
      // spunta tutte le serie del primo esercizio, poi la successiva sarà più giù
      for (let i = 0; i < 6; i++) { const c = await p.$('.sess-set-row.next .check'); if (!c) break; await c.click(); await p.waitForTimeout(700); }
      const vis = await p.evaluate(() => { const r = document.querySelector('#sessList .sess-set-row.next'); if (!r) return 'nessuna'; const b = r.getBoundingClientRect(), st = document.querySelector('.bottom-stack').getBoundingClientRect().top, tb = document.querySelector('.session-topbar').getBoundingClientRect().bottom; return b.top >= tb - 1 && b.bottom <= st + 1; });
      check(vis === true, 'dopo varie spunte la serie che tocca resta in vista: ' + vis);
      await p.locator('#tbStop').click().catch(() => {});
      await p.waitForTimeout(300);
      // anello del timer nella finestra: continuo
      await p.click('#timerBar').catch(() => {});
    }
    check(!A.errors.filter(x => !/Service Worker|404/.test(x)).length, tag + 'nessun errore ' + A.errors.join('|'));
    await A.browser.close();
  }
})();
