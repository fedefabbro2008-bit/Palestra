// chiave del connettore: nuova chiave (la vecchia non vale più), disattiva, server mancante, senza rete, scollegare la sincronizzazione lo dice
const { chromium } = require('playwright');
const { open } = require('./lib');
const { seedLogs } = require('./seed');
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
(async () => {
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} });
  const p = A.page;
  await p.evaluate(seedLogs, { weeks: 2 }); await p.reload(); await p.waitForTimeout(300);
  await p.click('#settingsBtn'); await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  await p.click('#mcpOnBtn'); await p.waitForTimeout(700);
  const u1 = await p.textContent('#mcpUrl');
  check(!(await p.isVisible('#mcpStatus')), 'nessun messaggio vuoto');
  await p.click('#mcpNewBtn'); await p.waitForTimeout(200); await p.click('#confirmYes'); await p.waitForTimeout(700);
  const u2 = await p.textContent('#mcpUrl');
  check(u1 !== u2 && /Chiave cambiata/.test(await p.textContent('#mcpStatus')), 'Nuova chiave: indirizzo cambiato, spiega cosa fare in Claude');
  await p.click('#mcpOffBtn'); await p.waitForTimeout(200); await p.click('#confirmYes'); await p.waitForTimeout(700);
  check(await p.isVisible('#mcpOnBtn') && /non legge più/.test(await p.textContent('#toastMsg')), 'Disattiva: torna «Collega Claude»');
  const old = u2.replace(/.*\/mcp\//, '');
  const r = await fetch('http://localhost:8888/mcp/' + old, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  check(r.status === 401, 'la chiave disattivata non funziona più (401)');
  await fetch('http://localhost:8888/__ctl?down=1');
  await p.click('#mcpOnBtn'); await p.waitForTimeout(700);
  check(/non risponde/.test(await p.textContent('#mcpStatus')), 'server mancante: lo dice');
  await fetch('http://localhost:8888/__ctl?down=0');
  await A.ctx.setOffline(true);
  await p.click('#mcpOnBtn'); await p.waitForTimeout(700);
  check(/Serve la rete/.test(await p.textContent('#mcpStatus')), 'senza rete: lo dice');
  await A.ctx.setOffline(false);
  // disattivare la sync con Claude collegato: lo dice
  await p.click('#mcpOnBtn'); await p.waitForTimeout(700);
  await p.click('#syncOffBtn'); await p.waitForTimeout(200);
  check(/Claude resta collegato/.test(await p.textContent('#confirmMsg')), 'togliere la sincronizzazione con Claude collegato: avvisa');
  await p.click('#confirmYes'); await p.waitForTimeout(300);
  check(!(await p.isVisible('#mcpCard')), 'senza sincronizzazione il riquadro di Claude sparisce');
  const er = A.errors.filter(e => !/Service Worker|404|Failed to load|ERR_INTERNET/.test(e)); check(!er.length, 'nessun errore ' + er.join('|'));
  await browser.close();
})();
