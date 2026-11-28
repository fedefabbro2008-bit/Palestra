// sicurezza: dati malevoli scritti sul server (prototipi, date impossibili, tipi sbagliati) non rompono né inquinano l'app
const { chromium } = require('playwright');
const { open } = require('./lib');
const CODE = 'ABCD-EFGH-JKLM-NPQR-STUV';
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  // dati malevoli scritti direttamente sul server (chi conosce il codice può farlo)
  const bad = `{"baseRev":0,
    "logs":{"__proto__":[{"id":"p1","dayKey":"A","entries":[{"name":"x","detail":[{"kg":1,"val":1}]}]}],
            "constructor":5, "2026-10-20":[{"id":"__proto__","dayKey":"__proto__","forDay":"constructor","startedAt":"abc","entries":[{"name":"Panca","muscle":"__proto__","type":"constructor","detail":[{"kg":"1e309","val":-5,"rpe":"x","at":"y","t":"__proto__"}]},null,7,"s"]},
                           {"id":"ok1","dayKey":"A","startedAt":1793000000000,"endedAt":1793003600000,"entries":[{"name":"Chest press","muscle":"Petto","detail":[{"kg":50,"val":10,"at":1793000100000}]}]}],
            "2026-99-99":[{}], "x":"y"},
    "days":{"__proto__":{"name":"P","exercises":[{"name":"p"}]},"constructor":{"name":"C","exercises":[{"name":"c","sets":"1e9","rest":-4,"kg":"NaN","type":"toString","muscle":"hasOwnProperty"}]},"A":{"name":"Lunedì","exercises":[{"name":"Chest press","sets":3,"reps":"8-12","muscle":"Petto","linkNext":true}]}},
    "daysAt":9999999999999,
    "settings":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"dark":"yes","bg":"<b>","reviewSnooze":{"from":"x"},"planStarts":["2026-02-31","2026-10-01","9999-01-01",5],"aiContext":7},
    "setAt":9999999999999}`;
  const r = await fetch('http://localhost:8888/api/sync?code=' + CODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bad });
  check(r.status === 200, 'dati malevoli scritti sul server');
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.click('#settingsBtn'); await p.click('#syncJoinBtn'); await p.fill('#syncCodeIn', CODE); await p.click('#syncJoinGo');
  await p.waitForTimeout(2000);
  const res = await p.evaluate(() => ({
    polluted: ({}).polluted, protoKeys: Object.keys(Object.prototype),
    status: document.getElementById('syncStatus').textContent,
    days: Object.keys(JSON.parse(localStorage.getItem('palestra:days'))),
    logs: JSON.parse(localStorage.getItem('palestra:logs')),
    st: JSON.parse(localStorage.getItem('palestra:settings')),
    pills: [...document.querySelectorAll('#dayPills .dp-key')].map(e => e.textContent)
  }));
  check(res.polluted === undefined && !res.protoKeys.length, 'nessun inquinamento di Object.prototype');
  check(/Sincronizzato/.test(res.status), 'collegato lo stesso: ' + res.status);
  check(JSON.stringify(res.days) === '["A"]' && JSON.stringify(res.pills) === '["Lunedì"]', 'scheda: tenuta solo la giornata valida (' + res.pills.join(',') + ')');
  const keys = Object.keys(res.logs); check(keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k)) && Object.values(res.logs).flat().some(s => s.id === 'ok1'), 'storico: date impossibili scartate, allenamento valido tenuto (' + keys.join(',') + ')');
  check(typeof res.st.dark === 'boolean' && (res.st.planStarts || []).every(d => typeof d === 'string' && d !== '2026-02-31') && typeof (res.st.aiContext || '') === 'string', 'impostazioni ripulite: ' + JSON.stringify({ dark: res.st.dark, planStarts: res.st.planStarts }));
  await p.click('#settingsClose');
  for (const t of ['stats', 'month', 'plan', 'workout']) { await p.click(`nav.bottom button[data-tab="${t}"]`); await p.waitForTimeout(300); }
  await p.click('#startSessionBtn'); await p.waitForTimeout(300);
  check(await p.isVisible('#sessionView'), 'tutte le sezioni si aprono e l\'allenamento parte');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
