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
await writeFile(join(DIR,'giardino-app.html'), out);
console.log('Scritto giardino/giardino-app.html'+(trigger?' (attività '+trigger+')':' (senza attività pianificata)'));
