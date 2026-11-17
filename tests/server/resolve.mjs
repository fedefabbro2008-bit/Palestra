// nelle prove le funzioni di Netlify usano l'archivio finto in memoria al posto di @netlify/blobs
export async function resolve(spec, ctx, next) {
  if (spec === '@netlify/blobs') return { url: new URL('./blobs-finto.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
