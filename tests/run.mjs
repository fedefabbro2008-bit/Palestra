#!/usr/bin/env node
/* Lancia tutte le prove dell'app (o solo quelle col nome che contiene le parole date) e dice quali passano.
     node tests/run.mjs                 tutte
     node tests/run.mjs barra telegram  solo quelle che contengono "barra" o "telegram"
     node tests/run.mjs --elenco        solo l'elenco
   Avvia da solo il server di prova (porta 8888) con le funzioni vere di netlify/functions, archivio e Telegram finti.
   Una prova passa se finisce senza errori, stampa almeno un "OK" e nessun "FAIL".
   Foto e file prodotti dalle prove: tests/.out/<nome>/ (non vanno nel progetto). */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTS } from './elenco.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '.out');
const PORT = 8888, BASE = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
// Playwright può essere installato globalmente: le prove lo trovano anche lì
let gl = ''; try { gl = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) {}
const NODE_PATH = [process.env.NODE_PATH, path.join(HERE, 'node_modules'), gl].filter(Boolean).join(path.delimiter);

if (args.includes('--elenco')) { TESTS.forEach(t => console.log(t.nome.padEnd(34), t.cosa)); process.exit(0); }
const scelte = args.filter(a => !a.startsWith('--'));
const daFare = scelte.length ? TESTS.filter(t => scelte.some(s => t.nome.includes(s))) : TESTS;
if (!daFare.length) { console.error('Nessuna prova con questo nome. Elenco: node tests/run.mjs --elenco'); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function up() { try { const r = await fetch(BASE + '/__ctl?ping=1'); return r.ok; } catch (e) { return false; } }

// server di prova
if (await up()) { console.error(`La porta ${PORT} è già occupata: chiudi l'altro server e riprova.`); process.exit(2); }
const srv = spawn(process.execPath, ['--import', path.join(HERE, 'server/hooks.mjs'), path.join(HERE, 'server/server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);
for (let i = 0; i < 50 && !(await up()); i++) await wait(100);
if (!(await up())) { console.error('Il server di prova non parte:\n' + srvLog); srv.kill(); process.exit(2); }

// dati di prova (al posto di un backup vero): generati ogni volta, con le date di oggi
const ctx = { OUT, BASE, fixture: path.join(OUT, 'backup-prova.json'), code: path.join(OUT, 'codice.txt') };
const prepara = async (nome, file, a) => {
  const r = await runOne({ nome, file, args: () => a });
  if (!r.ok) { console.error(`Preparazione «${nome}» non riuscita:\n` + r.out.slice(-1500)); srv.kill(); process.exit(1); }
};
function runOne(t) {
  return new Promise(res => {
    const dir = path.join(OUT, t.nome); fs.mkdirSync(dir, { recursive: true });
    const a = (t.args || (() => [dir]))(Object.assign({ dir }, ctx));
    const p = spawn(process.execPath, [path.join(HERE, t.file), ...a], { cwd: HERE, env: Object.assign({}, process.env, { BASE: BASE + '/', OUT: dir, FIXTURE: ctx.fixture, NODE_PATH }) });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const tm = setTimeout(() => { out += '\n[tempo scaduto: 5 minuti]'; p.kill('SIGKILL'); }, (t.minuti || 5) * 60000);
    p.on('close', code => {
      clearTimeout(tm);
      fs.writeFileSync(path.join(dir, 'uscita.txt'), out);
      const ok = (out.match(/^OK\b/gm) || []).length, fail = (out.match(/^FAIL\b/gm) || []).length;
      res({ ok: code === 0 && fail === 0 && (ok > 0 || t.senzaOk), nOk: ok, nFail: fail, code, out });
    });
  });
}

await prepara('prepara-dati', 'ui/prepara-dati.js', [ctx.fixture]);
const risultati = [];
const t0 = Date.now();
for (const t of daFare) {
  await fetch(BASE + '/__ctl?reset=1').catch(() => {});
  await fetch(BASE + '/__ctl?tgclear=1').catch(() => {});
  if (t.serveCodice) await prepara('prepara-codice', 'ui/prepara-codice.js', [ctx.code]);
  const s = Date.now();
  const r = await runOne(t);
  const sec = Math.round((Date.now() - s) / 1000);
  risultati.push(Object.assign({ nome: t.nome, sec }, r));
  console.log(`${r.ok ? '✔' : '✘'} ${t.nome.padEnd(34)} ${String(r.nOk).padStart(3)} ok${r.nFail ? `, ${r.nFail} FAIL` : ''}${r.code ? `, uscita ${r.code}` : ''}  (${sec} s)`);
  if (!r.ok) r.out.split('\n').filter(l => /^FAIL|Error|errore|tempo scaduto/i.test(l)).slice(0, 6).forEach(l => console.log('    ' + l.slice(0, 220)));
}
srv.kill();
const bad = risultati.filter(r => !r.ok);
const tot = risultati.reduce((a, r) => a + r.nOk, 0);
console.log(`\n${risultati.length - bad.length}/${risultati.length} prove passate · ${tot} controlli OK · ${Math.round((Date.now() - t0) / 60000)} min`);
if (bad.length) console.log('Non passate: ' + bad.map(r => r.nome).join(', ') + `\nDettagli: tests/.out/<nome>/uscita.txt`);
process.exit(bad.length ? 1 : 0);
