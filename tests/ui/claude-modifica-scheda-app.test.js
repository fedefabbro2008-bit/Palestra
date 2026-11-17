// Claude modifica la scheda (MCP) -> l'app la riceve: riquadro, avviso, Rimetti com'era, Rifai, Va bene, due dispositivi, conflitto
const { open, tab } = require('./lib');
const { chromium } = require('playwright');
const { seedLogs } = require('./seed');
const OUT = process.argv[2];
const BASE = 'http://localhost:8888';
const clean = e => e.filter(x => !/Service Worker|installing|404/.test(x));
function stableStr(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v); if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']'; return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}'; }
function hsh(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + str.length.toString(36); }
const check = (ok, what) => console.log((ok ? 'OK   ' : 'FAIL ') + what);
const rpc = async (token, name, args) => { const r = await fetch(`${BASE}/mcp/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }) }); return (await r.json()).result; };
const OPS = { motivo: 'Panca ferma da 3 sedute: più schiena e un esercizio per il petto alto', modifiche: [
  { azione: 'modifica', giornata: 'Lunedì', esercizio: 'Lat machine', valori: { serie: 4, ripetizioni: '6-10', kg: 55 } },
  { azione: 'aggiungi', giornata: 'Lunedì', dopo: 'Chest press', valori: { nome: 'Panca inclinata con manubri', muscolo: 'Petto', secondario: 'Spalle', serie: 3, ripetizioni: '8-12', recupero: 120 } },
  { azione: 'rimuovi', giornata: 'Mercoledì', esercizio: 'Pec deck' },
  { azione: 'sostituisci', giornata: 'Mercoledì', esercizio: 'Crunch ai cavi', valori: { nome: 'Dead bug', muscolo: 'Addominali' } },
  { azione: 'modifica', giornata: 'Lunedì', esercizio: 'Alzate laterali', valori: { recupero: 60 } },
  { azione: 'modifica', giornata: 'Lunedì', esercizio: 'Face pull', valori: { serie: 4 } },
  { azione: 'modifica', giornata: 'Lunedì', esercizio: 'Barchetta', valori: { ripetizioni: '12' } },
  { azione: 'modifica', giornata: 'Mercoledì', esercizio: 'Reverse pec deck', valori: { serie: 4 } },
] };
const daysOf = p => p.evaluate(() => JSON.parse(localStorage.getItem('palestra:days')));
const blob = async code => (await (await fetch(`${BASE}/api/sync?code=${encodeURIComponent(code)}`)).json());
const syncNow = async p => { await p.click('#settingsBtn'); await p.waitForTimeout(150); await p.click('#syncNowBtn'); await p.waitForTimeout(1400); };
const toast = p => p.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? document.getElementById('toastMsg').textContent + (document.getElementById('toastAct').style.display !== 'none' ? ' [' + document.getElementById('toastAct').textContent + ']' : '') : ''; });
const card = p => p.evaluate(() => { const c = document.querySelector('#claudeCard .claude-card'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : ''; });
(async () => {
  await fetch(BASE + '/__ctl?reset=1');
  const browser = await chromium.launch();
  const A = await open({ browser, ls: {} }), p = A.page;
  await p.evaluate(seedLogs, { weeks: 4 });
  await p.reload(); await p.waitForTimeout(400);
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  await p.click('#syncNewBtn'); await p.waitForTimeout(1500);
  const code = (await p.textContent('#syncCodeShow')).trim();
  await p.click('#mcpOnBtn'); await p.waitForTimeout(900);
  const token = (await p.textContent('#mcpBearer')).replace('Bearer ', '').trim();
  check(token.length === 26 && !(await p.isChecked('#mcpWriteToggle')) && /Spento/.test(await p.textContent('#mcpWriteSub')), 'chiave creata, permesso spento all\'inizio');
  let r = await rpc(token, 'modifica_scheda', OPS);
  check(r.isError && /permesso/.test(r.content[0].text), 'Claude senza permesso: rifiutato');
  await p.click('label.switch:has(#mcpWriteToggle)'); await p.waitForTimeout(900);
  check(await p.isChecked('#mcpWriteToggle') && /Acceso/.test(await p.textContent('#mcpWriteSub')), 'interruttore acceso: ' + await p.textContent('#mcpWriteSub'));
  check(/modificare la scheda/.test(await toast(p)), 'avviso: ' + await toast(p));
  await p.evaluate(() => document.getElementById('mcpCard').scrollIntoView({ block: 'start' })); await p.waitForTimeout(150);
  await p.locator('#mcpCard').screenshot({ path: OUT + '/c1-impostazioni.png' });
  // riapri le Impostazioni: lo stato arriva dal server
  await p.click('#settingsClose'); await p.waitForTimeout(250); await p.click('#settingsBtn'); await p.waitForTimeout(900);
  check(await p.isChecked('#mcpWriteToggle'), 'riaperte le Impostazioni: ancora acceso (dal server)');
  await p.click('#settingsClose'); await p.waitForTimeout(250);
  const before = await daysOf(p);
  r = await rpc(token, 'modifica_scheda', OPS);
  check(!r.isError, 'Claude modifica la scheda');
  const srv1 = await blob(code);
  // l'app sincronizza (come all'apertura)
  await syncNow(p);
  check(/Claude ha modificato la scheda/.test(await toast(p)), 'avviso all\'arrivo: ' + await toast(p));
  await p.click('#settingsClose'); await p.waitForTimeout(300);
  const local1 = await daysOf(p);
  check(stableStr(local1) === stableStr(srv1.days), 'scheda qui identica a quella scritta da Claude (nessuna differenza fantasma)');
  check(hsh(stableStr(local1)) === srv1.claude.hash, 'impronta uguale al segno del server');
  const c1 = await card(p);
  check(/Claude ha modificato la scheda/.test(c1) && /Panca ferma da 3 sedute/.test(c1) && /8 modifiche/.test(c1), 'riquadro: ' + c1.slice(0, 160));
  check(/Mostra tutte \(8\)/.test(c1), 'righe oltre 6: "Mostra tutte"');
  await p.evaluate(() => document.getElementById('claudeCard').scrollIntoView({ block: 'start' })); await p.waitForTimeout(150);
  await p.locator('#claudeCard').screenshot({ path: OUT + '/c2-riquadro.png' });
  await p.click('#claudeMore'); await p.waitForTimeout(150);
  check((await p.$$eval('#claudeCard .cl-lines li', l => l.length)) === 8, 'Mostra tutte: 8 righe');
  check(await p.evaluate(() => !!localStorage.getItem('palestra:days-backup-vclaude')), 'scheda di prima salvata anche come backup (Ripristina)');
  // seconda sincronizzazione: niente da prendere né da mandare
  const rev1 = (await blob(code)).rev;
  await syncNow(p); await p.click('#settingsClose'); await p.waitForTimeout(200);
  check((await blob(code)).rev === rev1 && stableStr(await daysOf(p)) === stableStr(local1), 'seconda sincronizzazione: nessun cambiamento (rev ' + rev1 + ')');
  check(/Claude ha modificato/.test(await card(p)), 'riquadro ancora lì');
  // ricarica: il riquadro resta
  await p.reload(); await p.waitForTimeout(800);
  check(/Claude ha modificato/.test(await card(p)), 'dopo ricarica: riquadro ancora lì');
  // Rimetti com'era
  await p.click('#claudeUndo'); await p.waitForTimeout(250);
  check(/prima delle modifiche di Claude/.test(await p.textContent('#confirmMsg')), 'conferma: ' + await p.textContent('#confirmMsg'));
  await p.click('#confirmYes'); await p.waitForTimeout(400);
  check(stableStr(await daysOf(p)) === stableStr(before), 'scheda rimessa com\'era prima');
  check(/rimessa com'era \[Rifai\]/.test(await toast(p)), 'avviso: ' + await toast(p));
  check(!(await card(p)), 'riquadro sparito');
  await p.waitForTimeout(3200);   // sincronizza da sola dopo la modifica
  const srv2 = await blob(code);
  check(stableStr(srv2.days) === stableStr(before), 'sul server la scheda di prima');
  r = await rpc(token, 'annulla_modifica');
  check(r.isError && /cambiata/.test(r.content[0].text), 'annulla_modifica dopo Rimetti: rifiutato (già annullata)');
  // Claude modifica ancora; stavolta Va bene
  r = await rpc(token, 'modifica_scheda', { motivo: 'Recupero più corto sulle alzate', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Alzate laterali', valori: { recupero: 45 } }] });
  await syncNow(p); await p.click('#settingsClose'); await p.waitForTimeout(250);
  const c2 = await card(p);
  check(/Recupero più corto/.test(c2) && /1 modifica/.test(c2) && !/Mostra tutte/.test(c2), 'riquadro con 1 modifica: ' + c2.slice(0, 140));
  // due dispositivi: B si collega e vede anche lui la modifica di Claude
  const B = await open({ browser, ls: {} }), q = B.page;
  await q.click('#settingsBtn'); await q.click('#syncJoinBtn'); await q.fill('#syncCodeIn', code); await q.click('#syncJoinGo'); await q.waitForTimeout(2000);
  await q.click('#settingsClose'); await q.waitForTimeout(300);
  check(!(await card(q)), 'B appena collegato: nessun riquadro (la scheda è arrivata col collegamento)');
  r = await rpc(token, 'modifica_scheda', { motivo: 'Una serie in più di face pull', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Face pull', valori: { serie: 5 } }] });
  await syncNow(q); await q.click('#settingsClose'); await q.waitForTimeout(300);
  check(/Una serie in più di face pull/.test(await card(q)), 'B riceve la modifica di Claude: riquadro');
  await syncNow(p); await p.click('#settingsClose'); await p.waitForTimeout(300);
  check(/Una serie in più di face pull/.test(await card(p)), 'A (dopo B) vede la stessa modifica: il segno resta sul server');
  await p.click('#claudeOk'); await p.waitForTimeout(200);
  check(!(await card(p)) && !(await p.evaluate(() => localStorage.getItem('palestra:claude'))), 'Va bene: riquadro chiuso');
  // tu cambi la scheda dopo Claude: il riquadro non vale più
  check(/face pull/.test(await card(q)), 'B: riquadro ancora aperto');
  await q.click('#planEditBtn'); await q.waitForTimeout(200);
  await q.fill('#exList input[data-f="rest"] >> nth=0', '33'); await q.dispatchEvent('#exList input[data-f="rest"] >> nth=0', 'change');
  await q.click('#planEditBtn'); await q.waitForTimeout(300);
  check(!(await card(q)), 'B cambia la scheda: riquadro sparito');
  await q.waitForTimeout(3200);
  // conflitto: Claude scrive, poi A (senza rete verso la sync) cambia la scheda; alla sincronizzazione vince A e lo dice
  await syncNow(p); await p.click('#settingsClose'); await p.waitForTimeout(200);
  r = await rpc(token, 'modifica_scheda', { motivo: 'Prova conflitto', modifiche: [{ azione: 'modifica', giornata: 'A', esercizio: 'Barchetta', valori: { serie: 5 } }] });
  await fetch(BASE + '/__ctl?down=1');
  await p.click('#planEditBtn'); await p.waitForTimeout(200);
  await p.fill('#exList input[data-f="rest"] >> nth=1', '44'); await p.dispatchEvent('#exList input[data-f="rest"] >> nth=1', 'change');
  await p.click('#planEditBtn'); await p.waitForTimeout(3500);
  await fetch(BASE + '/__ctl?down=0');
  await syncNow(p);
  check(/non applicate/.test(await toast(p)), 'conflitto: ' + await toast(p));
  await p.click('#settingsClose'); await p.waitForTimeout(200);
  const srv3 = await blob(code);
  check(srv3.days.A.exercises.find(e => e.name.startsWith('Barchetta')).sets !== 5, 'vince la modifica fatta qui dopo');
  // schermo stretto e tema scuro: il riquadro sta nella pagina
  r = await rpc(token, 'modifica_scheda', { motivo: 'Riquadro su schermo stretto con un motivo un po\' più lungo del solito, per vedere come va a capo', modifiche: [{ azione: 'sostituisci', giornata: 'B', esercizio: 'Reverse pec deck', valori: { nome: 'Alzate posteriori ai cavi incrociati, in piedi, busto inclinato', muscolo: 'Spalle' } }] });
  const N = await open({ browser, ls: {}, w: 320, h: 700 }), n = N.page;
  await n.click('#settingsBtn'); await n.click('#syncJoinBtn'); await n.fill('#syncCodeIn', code); await n.click('#syncJoinGo'); await n.waitForTimeout(2000);
  r = await rpc(token, 'modifica_scheda', { motivo: 'Riquadro su schermo stretto con un motivo un po\' più lungo del solito, per vedere come va a capo', modifiche: [{ azione: 'modifica', giornata: 'B', esercizio: 'Alzate posteriori', valori: { serie: 4, recupero: 75 } }] });
  await n.click('#syncNowBtn'); await n.waitForTimeout(1400); await n.click('#settingsClose'); await n.waitForTimeout(300);
  await n.evaluate(() => document.body.classList.add('dark'));
  const over = await n.evaluate(() => [...document.querySelectorAll('#claudeCard *')].filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName));
  check(!!(await card(n)) && !over.length, 'a 320 px nessun elemento esce dallo schermo ' + JSON.stringify(over));
  await n.evaluate(() => document.getElementById('claudeCard').scrollIntoView({ block: 'start' })); await n.waitForTimeout(150);
  await n.locator('#claudeCard').screenshot({ path: OUT + '/c3-320-scuro.png' });
  console.log('errori A', JSON.stringify(clean(A.errors)), '| B', JSON.stringify(clean(B.errors)), '| N', JSON.stringify(clean(N.errors)));
  await browser.close();
})();
