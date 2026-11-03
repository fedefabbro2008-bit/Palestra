// Netlify Blobs in memoria, per i test: stesse funzioni usate dal sito (get, getWithMetadata, setJSON con onlyIfMatch/onlyIfNew, delete, list).
const mem = (globalThis.__BLOBS ??= new Map());
let n = 0;
export function getStore() {
  return {
    async get(k) { const v = mem.get(k); return v ? structuredClone(v.val) : null; },
    async getWithMetadata(k) { const v = mem.get(k); return v ? { data: structuredClone(v.val), etag: v.etag } : null; },
    async setJSON(k, val, o = {}) {
      const cur = mem.get(k);
      if (o.onlyIfNew && cur) return { modified: false };
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = "e" + ++n; mem.set(k, { val: structuredClone(val), etag }); return { modified: true, etag };
    },
    async delete(k) { mem.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
  };
}
