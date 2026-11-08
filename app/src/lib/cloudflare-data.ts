import 'server-only';

/** Server-only transport for the L8R SQLite Durable Object. */
export const cloudflareSelected = (): boolean => process.env.L8R_STORAGE_BACKEND === 'cloudflare';

function endpoint(): URL | null {
  const raw = process.env.L8R_DATA_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const local = process.env.NODE_ENV !== 'production' && localhost;
    if (localhost && !local) return null;
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.pathname !== '/internal' || url.search || url.hash || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

export const cloudflareConfigured = (): boolean =>
  endpoint() !== null && typeof process.env.L8R_DATA_SECRET === 'string' &&
  process.env.L8R_DATA_SECRET.length >= 32;

export class L8RDataError extends Error {
  constructor(public readonly code: 'configuration_error' | 'unavailable' | 'invalid_response') {
    super(`L8R data ${code}`);
    this.name = 'L8RDataError';
  }
}

export async function callL8RData<T>(request: Record<string, unknown>): Promise<T> {
  const url = endpoint();
  const secret = process.env.L8R_DATA_SECRET;
  if (!cloudflareSelected() || !url || !secret || secret.length < 32)
    throw new L8RDataError('configuration_error');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new L8RDataError('unavailable'); }
  if (!response.ok) throw new L8RDataError('unavailable');
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new L8RDataError('invalid_response'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    (body as { ok?: unknown }).ok !== true || !Object.hasOwn(body, 'result'))
    throw new L8RDataError('invalid_response');
  return (body as { result: T }).result;
}
