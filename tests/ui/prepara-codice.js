const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 6, rpe: true });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('palestra:settings')); s.aiContext = 'ginocchio dolorante, polso destro: presa neutra; obiettivo ipertrofia'; localStorage.setItem('palestra:settings', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  require("fs").writeFileSync(process.argv[2], code); console.log("OK   codice di sincronizzazione pronto");
  console.log('codice', code, '| stato', await p.textContent('#syncStatus'));
  await browser.close();
})();
