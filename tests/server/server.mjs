import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
/* Server di prova: serve l'app e chiama le funzioni VERE di netlify/functions (non copie), con l'archivio finto
   (blobs-finto.mjs, via hooks.mjs) e un Telegram finto. Avvio: node --import ./tests/server/hooks.mjs tests/server/server.mjs [porta]
   /__ctl?reset=1 svuota l'archivio; altri comandi: delay, fail, down, dump, tgrun, tglog, tgclear, tgfail, tgnoupd. */
import { fileURLToPath } from 'node:url';
import handler from '../../netlify/functions/sync.mjs';
import mcpHandler from '../../netlify/functions/mcp.mjs';
import tgScheduled from '../../netlify/functions/telegram-backup.mjs';
// Telegram finto: registra le chiamate, risponde come l'API vera
globalThis.tgFake = { calls: [], fail: null, updates: [{ update_id: 1, message: { chat: { id: 4242, type: 'private', first_name: 'Fede' } } }] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = String(u);
  if (!url.startsWith('https://api.telegram.org/bot')) return realFetch(u, o);
  const m = url.slice(28).split('/'), token = m[0], method = m[1], F = globalThis.tgFake;
  let body = {};
  if (o && o.body instanceof FormData) { for (const [k, v] of o.body.entries()) body[k] = typeof v === 'string' ? v : { name: v.name, size: v.size, text: await v.text() }; }
  else if (o && o.body) body = JSON.parse(o.body);
  F.calls.push({ token, method, body });
  const J = (x) => new Response(JSON.stringify(x), { status: x.ok ? 200 : 400, headers: { 'content-type': 'application/json' } });
  if (!token.endsWith('GOOD')) return J({ ok: false, description: 'Unauthorized' });
  if (F.fail && F.fail === method) return J({ ok: false, description: 'Bad Request: chat not found' });
  if (method === 'getMe') return J({ ok: true, result: { username: 'palestra_test_bot' } });
  if (method === 'getUpdates') return J({ ok: true, result: F.updates });
  if (method === 'getChat') return J({ ok: true, result: { first_name: 'Chat', last_name: 'Manuale' } });
  if (method === 'sendDocument') return J({ ok: true, result: { message_id: 1 } });
  return J({ ok: false, description: 'unknown' });
};
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url))), PORT = +process.argv[2] || +process.env.PORT || 8888;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.json':'application/json', '.mjs':'application/javascript', '.toml':'text/plain', '.woff2':'font/woff2', '.png':'image/png' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = new Request(url, { method: req.method, headers: req.headers, body: ['GET','HEAD','OPTIONS','DELETE'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await mcpHandler(r);
    res.writeHead(out.status, Object.fromEntries(out.headers)); return res.end(Buffer.from(await out.arrayBuffer()));
  }
  if (url.pathname === '/api/sync') {
    if (globalThis.__apiDown) { res.writeHead(404); return res.end(); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = new Request(url, { method: req.method, headers: req.headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await handler(r);
    res.writeHead(out.status, Object.fromEntries(out.headers)); return res.end(Buffer.from(await out.arrayBuffer()));
  }
  if (url.pathname === '/__ctl') { const q = url.searchParams; if (q.has('delay')) globalThis.__delayWrite = +q.get('delay'); if (q.has('fail')) globalThis.__fail = q.get('fail')==='1'; if (q.has('down')) globalThis.__apiDown = q.get('down')==='1'; if (q.has('dump')) { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify([...(globalThis.__stores||new Map()).entries()].map(([k,m])=>[k,[...m.entries()]]))); } if(q.has('reset')) (globalThis.__stores||new Map()).clear(); if (q.has('tgrun')) { await tgScheduled(new Request('http://x')); } if (q.has('tglog')) { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(globalThis.tgFake.calls)); } if (q.has('tgclear')) globalThis.tgFake.calls = []; if (q.has('tgfail')) globalThis.tgFake.fail = q.get('tgfail') || null; if (q.has('tgnoupd')) globalThis.tgFake.updates = q.get('tgnoupd')==='1' ? [] : [{ update_id: 1, message: { chat: { id: 4242, type: 'private', first_name: 'Fede' } } }]; res.writeHead(200); return res.end('ok'); }
  if (globalThis.__fail && !url.pathname.endsWith('sw.js')) { res.writeHead(500); return res.end('errore'); }
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('in ascolto su ' + PORT));
