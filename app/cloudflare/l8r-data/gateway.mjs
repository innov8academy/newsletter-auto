const MAX_BYTES = 16 * 1024 * 1024;
export function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

// Always hash both strings, then compare all digest bytes. Never echo either value.
export async function authorized(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice(7);
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = supplied.length === secret.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

export async function dispatch(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/internal' || request.method !== 'POST') return response(404, { ok: false, error: 'not_found' });
  if (!await authorized(request.headers.get('Authorization'), env.INTERNAL_SECRET)) return response(401, { ok: false, error: 'unauthorized' });
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return response(415, { ok: false, error: 'unsupported_media_type' });
  if (!env.L8R_DATA) return response(503, { ok: false, error: 'unavailable' });
  let raw;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return response(413, { ok: false, error: 'too_large' });
    JSON.parse(raw);
  } catch { return response(400, { ok: false, error: 'invalid_json' }); }
  const stub = env.L8R_DATA.get(env.L8R_DATA.idFromName('l8r-primary'));
  return stub.fetch(new Request('https://l8r-object/internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }));
}
