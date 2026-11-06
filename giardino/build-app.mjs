// Costruisce l'app Giardino per Netlify: app.src.html + modello.mjs + netlify-shim.js → giardino-netlify/public/index.html
// e copia il modello per le funzioni (giardino-netlify/netlify/lib/modello.mjs). Uso: node giardino/build-app.mjs
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url)), NET = join(DIR, '..', 'giardino-netlify');
const src = await readFile(join(DIR, 'app.src.html'), 'utf8');
if (!src.includes('/*@@MODELLO@@*/')) throw new Error('Segnaposto del modello mancante');
const modello = (await readFile(join(DIR, 'modello.mjs'), 'utf8')).replace(/^export /gm, '');
const shim = await readFile(join(DIR, 'netlify-shim.js'), 'utf8');
const app = src.replace('/*@@MODELLO@@*/', () => modello);
const cut = app.indexOf('<div class="wrap">');
const head = app.slice(0, cut), body = app.slice(cut).replace('<script>', () => '<script>\n' + shim + '\n</script>\n<script>');
await mkdir(join(NET, 'public'), { recursive: true }); await mkdir(join(NET, 'netlify', 'lib'), { recursive: true });
await writeFile(join(NET, 'public', 'index.html'), `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="format-detection" content="telephone=no">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Giardino">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#f2f4f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1512" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icona-192.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${head}</head>
<body>
${body}
</body>
</html>
`);
await copyFile(join(DIR, 'modello.mjs'), join(NET, 'netlify', 'lib', 'modello.mjs'));
// Impronta della versione del sito: cambia a ogni pubblicazione che cambia qualcosa. Il bot conta le impronte nuove del mese
// per stimare i crediti Netlify (ogni pubblicazione costa 15 crediti).
const file = [];
for (const dir of ['public', 'netlify/functions', 'netlify/lib']) for (const f of (await readdir(join(NET, dir))).sort()) if (f !== 'versione.mjs') file.push(join(NET, dir, f));
file.push(join(NET, 'netlify.toml'));
const h = createHash('sha256'); for (const f of file) h.update(f.slice(NET.length) + '\0').update(await readFile(f));
await writeFile(join(NET, 'netlify', 'lib', 'versione.mjs'), `// generato da giardino/build-app.mjs: impronta della versione pubblicata\nexport const VERSIONE = "${h.digest('hex').slice(0, 12)}";\n`);
console.log('Scritto giardino-netlify/public/index.html e giardino-netlify/netlify/lib/modello.mjs');
