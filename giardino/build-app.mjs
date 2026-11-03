// Costruisce l'app pubblicata come artifact: app.src.html + modello.mjs → giardino-app.html
// Uso: node giardino/build-app.mjs [id-attività-pianificata]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(DIR,'app.src.html'),'utf8');
const modello = (await readFile(join(DIR,'modello.mjs'),'utf8')).replace(/^export /gm,'');
const syncPrompt = (await readFile(join(DIR,'sync-prompt.txt'),'utf8')).trim();
const trigger = process.argv[2] || process.env.GIARDINO_TRIGGER_ID || '';
if(!src.includes('/*@@MODELLO@@*/')) throw new Error('Segnaposto del modello mancante');
const out = src.replace('/*@@MODELLO@@*/', () => modello).replace("'@@TRIGGER_ID@@'", () => JSON.stringify(trigger))
  .replace("'@@SYNC_SESSION@@'", () => JSON.stringify(process.env.GIARDINO_SYNC_SESSION || 'session_01WPDxmqiuSo7wZJoVm9CY74'))
  .replace("'@@SYNC_ENV@@'", () => JSON.stringify(process.env.GIARDINO_SYNC_ENV || 'env_01VyxiXuTkVdJfLs7YMuKQ11'))
  .replace("'@@SYNC_PROMPT@@'", () => JSON.stringify(syncPrompt).replace(/</g,'\\u003c'));
await writeFile(join(DIR,'giardino-app.html'), out.replace("'@@STANDALONE@@'", "'false'"));
// Versione autonoma per GitHub Pages: niente abbonamento Claude (standalone.js sostituisce le funzioni di claude.ai)
const shim = await readFile(join(DIR,'standalone.js'),'utf8');
const sa = out.replace("'@@STANDALONE@@'", "'true'");
const cut = sa.indexOf('<div class="wrap">');
const head = sa.slice(0,cut), body = sa.slice(cut).replace('<script>', () => '<script>\n'+shim+'\n</script>\n<script>');
await writeFile(join(DIR,'index.html'), `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Giardino">
<meta name="theme-color" content="#0f1512">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}</style>
${head}</head>
<body>
${body}
</body>
</html>
`);
console.log('Scritto giardino/index.html (versione autonoma, GitHub Pages)');
console.log('Scritto giardino/giardino-app.html'+(trigger?' (attività '+trigger+')':' (senza attività pianificata)'));
