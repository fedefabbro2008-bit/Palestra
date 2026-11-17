// finto archivio blobs in memoria: stessa API usata da sync.mjs
const stores = globalThis.__stores || (globalThis.__stores = new Map());
let n = 0;
export function getStore({ name }) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async getWithMetadata(key) { const v = m.get(key); return v ? { data: JSON.parse(v.text), etag: v.etag, metadata: {} } : null; },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) { return { blobs: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, etag: v.etag })) }; },
    async getMetadata(key) { const v = m.get(key); return v ? { etag: v.etag, metadata: {} } : null; },
    async get(key) { const v = m.get(key); return v ? JSON.parse(v.text) : null; },
    async setJSON(key, data, cond = {}) {
      // attesa (rete lenta) PRIMA del controllo: controllo e scrittura insieme, come il vero archivio (atomico)
      if (globalThis.__delayWrite) await new Promise(r => setTimeout(r, globalThis.__delayWrite));
      const cur = m.get(key);
      if (cond.onlyIfNew && cur) return { modified: false };
      if (cond.onlyIfMatch && (!cur || cur.etag !== cond.onlyIfMatch)) return { modified: false };
      const etag = '"e' + (++n) + '"';
      m.set(key, { text: JSON.stringify(data), etag });
      return { modified: true, etag };
    },
  };
}
