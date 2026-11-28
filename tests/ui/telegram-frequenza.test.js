// backup su Telegram: si sceglie ogni quanto arriva (ogni giorno, ogni lunedì, il 1° e il 16, il 1° del mese).
// La scelta fatta prima di «Collega» vale da subito; cambiata dopo si salva sul server e cambia «Prossimo backup».
// La funzione programmata gira ogni giorno e manda solo nei giorni che toccano; un backup arrivato da meno di 12 ore
// non si ripete
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const BASE = 'http://localhost:8888';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const ctl = async (q) => (await fetch(BASE + '/__ctl?' + q)).text();
const sent = async () => JSON.parse(await ctl('tglog=1')).filter((c) => c.method === 'sendDocument').length;
const run = async (iso) => { await ctl('tgclear=1'); await ctl('tgrun=' + encodeURIComponent(iso)); return sent(); };
const GOOD = '123456789:' + 'A'.repeat(31) + 'GOOD';
(async () => {
  await ctl('reset=1'); await ctl('tgclear=1');
  const A = await open({ ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 3 }); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  const srv = async () => (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=tg`)).json();
  // prima di collegare: la scelta c'è, di serie due volte al mese
  const f0 = await p.evaluate(() => ({ v: document.getElementById('tgFreq').value, vis: !!document.getElementById('tgFreq').offsetParent, opts: [...document.querySelectorAll('#tgFreq option')].map((o) => o.textContent) }));
  check(f0.vis && f0.v === 'quindici' && f0.opts.length === 4, `«Ogni quanto» prima di collegare: ${f0.opts.join(' / ')} (scelta: ${f0.v})`);
  await p.selectOption('#tgFreq', 'settimana');
  await p.fill('#tgToken', GOOD); await p.click('#tgOnBtn'); await p.waitForTimeout(1000);
  let s = await srv();
  check(s.active && s.freq === 'settimana' && new Date(s.next).getUTCDay() === 1, `collegato con «ogni settimana»: sul server ${s.freq}, prossimo ${new Date(s.next).toISOString().slice(0, 10)} (lunedì)`);
  check(/Prossimo backup/.test(await p.textContent('#tgState')) && await p.evaluate(() => document.getElementById('tgFreq').value) === 'settimana', 'nell\'app: scelta tenuta e prossimo backup');
  check(await run('2026-06-02T07:00:00Z') === 0 && await run('2026-06-08T07:00:00Z') === 1, 'ogni settimana: martedì niente, lunedì sì');
  // cambiata dopo: una volta al mese
  await p.selectOption('#tgFreq', 'mese'); await p.waitForTimeout(800);
  s = await srv();
  check(s.freq === 'mese' && new Date(s.next).getUTCDate() === 1 && /Frequenza salvata/.test(await p.textContent('#toastMsg')), `cambiata in «una volta al mese»: prossimo ${new Date(s.next).toISOString().slice(0, 10)}`);
  check(await run('2026-06-16T07:00:00Z') === 0 && await run('2026-06-08T07:00:00Z') === 0 && await run('2026-07-01T07:00:00Z') === 1, 'una volta al mese: il 16 e il lunedì niente, il 1° sì');
  // due volte al mese: 1 e 16
  await p.selectOption('#tgFreq', 'quindici'); await p.waitForTimeout(800);
  check(await run('2026-06-16T07:00:00Z') === 1 && await run('2026-06-10T07:00:00Z') === 0, 'due volte al mese: il 16 sì, il 10 niente');
  // ogni giorno, ma non due volte nelle stesse 12 ore
  await p.selectOption('#tgFreq', 'giorno'); await p.waitForTimeout(800);
  check(await run('2026-06-10T07:00:00Z') === 1, 'ogni giorno: anche un mercoledì qualsiasi');
  const lastAt = (await srv()).last.at;   // l'ultimo backup è appena arrivato (ora vera)
  check(await run(new Date(lastAt + 3600e3).toISOString()) === 0, 'un\'ora dopo un backup arrivato: non si ripete');
  // valore non valido rifiutato
  const bad = await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}&op=tg`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'freq', freq: 'ogni ora' }) });
  check(bad.status === 400 && (await srv()).freq === 'giorno', 'frequenza inventata: rifiutata, resta quella di prima');
  const errs = A.errors.filter((x) => !/Service Worker|404|status of (4|5)\d\d/.test(x));
  check(!errs.length, 'nessun errore ' + errs.join(' | '));
  await A.browser.close();
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
