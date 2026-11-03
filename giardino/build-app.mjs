// Costruisce l'app pubblicata come artifact: app.src.html + modello.mjs → giardino-app.html
// Uso: node giardino/build-app.mjs [id-attività-pianificata]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(DIR,'app.src.html'),'utf8');
const modello = (await readFile(join(DIR,'modello.mjs'),'utf8')).replace(/^export /gm,'');
const trigger = process.argv[2] || process.env.GIARDINO_TRIGGER_ID || '';
if(!src.includes('/*@@MODELLO@@*/')) throw new Error('Segnaposto del modello mancante');
const out = src.replace('/*@@MODELLO@@*/', () => modello).replace("'@@TRIGGER_ID@@'", () => JSON.stringify(trigger));
await writeFile(join(DIR,'giardino-app.html'), out);
console.log('Scritto giardino/giardino-app.html'+(trigger?' (attività '+trigger+')':' (senza attività pianificata)'));
