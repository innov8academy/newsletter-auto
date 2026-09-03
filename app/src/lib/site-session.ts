export const SESSION_COOKIE = 'site-auth';
const encoder = new TextEncoder();
const TTL = 7 * 24 * 60 * 60;
export function sameRequestOrigin(
  origin: string | null,
  requestUrl: string,
  hostHeader: string | null,
): boolean {
  if (!origin) return true; // Non-browser API clients still require a valid signed session.
  try {
    const incoming = new URL(origin);
    const target = new URL(requestUrl);
    // Next's dev server may canonicalize request URLs to localhost while retaining
    // the actual browser-facing host in Host. Do not trust X-Forwarded-Host here.
    return (
      incoming.origin === origin &&
      incoming.protocol === target.protocol &&
      (incoming.host === target.host || incoming.host === hostHeader)
    );
  } catch {
    return false;
  }
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decode(text: string): Uint8Array {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export function sessionConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.SITE_PASSWORD && (env.SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY),
  );
}
export function localDevelopment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== 'production' && !env.SITE_PASSWORD;
}
async function key(env: NodeJS.ProcessEnv) {
  const secret = env.SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Session signing is not configured.');
  // Domain separation avoids using the existing server credential directly as a signing key.
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('l8r-session-v1'),
      info: encoder.encode('site-password-session'),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}
export async function createSession(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<string> {
  const passwordVersion = encode(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        await key(env),
        encoder.encode('password-version:' + env.SITE_PASSWORD),
      ),
    ),
  );
  const payload = encode(
    encoder.encode(
      JSON.stringify({
        v: 1,
        exp: Math.floor(now / 1000) + TTL,
        nonce: crypto.randomUUID(),
        passwordVersion,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(env),
    encoder.encode(payload),
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifySession(
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<boolean> {
  if (localDevelopment(env)) return true;
  if (!sessionConfigured(env) || !token || token.length > 2048) return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (
      !payload ||
      !signature ||
      extra ||
      !(await crypto.subtle.verify(
        'HMAC',
        await key(env),
        new Uint8Array(decode(signature)).buffer,
        encoder.encode(payload),
      ))
    )
      return false;
    const parsed = JSON.parse(new TextDecoder().decode(decode(payload)));
    const passwordVersion = encode(
      new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          await key(env),
          encoder.encode('password-version:' + env.SITE_PASSWORD),
        ),
      ),
    );
    return (
      parsed.v === 1 &&
      Number.isFinite(parsed.exp) &&
      parsed.exp > now / 1000 &&
      parsed.passwordVersion === passwordVersion
    );
  } catch {
    return false;
  }
}
export async function correctPassword(
  value: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all(
    [value, expected].map((text) =>
      crypto.subtle.digest('SHA-256', encoder.encode(text)),
    ),
  );
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  left.forEach((byte, i) => {
    difference |= byte ^ right[i];
  });
  return difference === 0;
}
