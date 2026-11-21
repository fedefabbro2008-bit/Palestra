// collegamento con Claude: compare solo con la sincronizzazione, indirizzo creato, copiato, ancora attivo dopo la riapertura
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.evaluate(seedLogs, { weeks: 4 }); await p.reload(); await p.waitForTimeout(300);
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  check(!(await p.isVisible('#mcpCard')), 'senza sincronizzazione il riquadro di Claude non c\'è');
  await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  check(await p.isVisible('#mcpCard') && /Collega Claude/.test(await p.textContent('#mcpOnBtn')), 'con la sincronizzazione: «Collega Claude»');
  await p.click('#mcpOnBtn'); await p.waitForTimeout(800);
  const url = await p.evaluate(() => document.getElementById('mcpUrl').textContent);
  check(/\/mcp\/[A-Z2-7]{26}$/.test(url), 'indirizzo del connettore: ' + url.replace(/[A-Z2-7]{26}$/, '…'));
  await p.click('#mcpCopyBtn'); await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check(clip === url && /copiato/.test(await p.textContent('#toastMsg')), 'Copia: indirizzo negli appunti');
  require('fs').writeFileSync(OUT + '/mcp-url.txt', clip);
  await p.evaluate(() => document.getElementById('mcpCard').scrollIntoView({ block: 'start' }));
  await p.click('#mcpCard summary'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/120-mcp-card.png' });
  // riapro le Impostazioni: lo stato arriva dal server
  await p.click('#settingsClose'); await p.waitForTimeout(300); await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.waitForTimeout(800);
  check(await p.isVisible('#mcpOn') && (await p.textContent('#mcpUrl')) === url, 'riaperta l\'app: collegamento attivo, stesso indirizzo');
  const er = A.errors.filter(e => !/Service Worker|404/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
