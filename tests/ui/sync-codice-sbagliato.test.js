// codice di sincronizzazione sbagliato: non collega e non crea spazi vuoti sul server
const { chromium } = require('playwright');
const { open } = require('./lib');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.click('#settingsBtn'); await p.click('#syncJoinBtn');
  await p.fill('#syncCodeIn', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZ9');   // codice sbagliato (nessun dato sul server)
  await p.click('#syncJoinGo'); await p.waitForTimeout(1500);
  check(/Nessun dato con questo codice/.test(await p.textContent('#toastMsg')) && !(await p.isVisible('#syncOn')), 'codice sbagliato: avviso e niente collegamento');
  const dump = await (await fetch('http://localhost:8888/__ctl?dump=1')).json();
  const spazi = dump.flatMap(([n, e]) => e.map(x => x[0])); check(!spazi.length, 'nessuno spazio creato sul server ' + JSON.stringify(spazi));
  await browser.close();
})();
