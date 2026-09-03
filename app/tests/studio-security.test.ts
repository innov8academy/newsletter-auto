import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  createSession,
  verifySession,
  correctPassword,
  sameRequestOrigin,
} from '../src/lib/site-session';
import {
  downloadPublicImage,
  isPublicAddress,
  normalizeReference,
  prepareOutput,
  publicDestination,
} from '../src/lib/studio/media';
import { deduplicateCandidates } from '../src/lib/studio/search';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { requireStudioSession } from '../src/lib/studio/http';

test('signed sessions reject the old marker, tampering, expiry, and password changes', async () => {
  const env = {
    NODE_ENV: 'production',
    SITE_PASSWORD: 'test-password',
    SESSION_SECRET: 'a-strong-test-secret-longer-than-thirty-two-characters',
  } as NodeJS.ProcessEnv;
  const now = Date.now();
  const token = await createSession(env, now);
  assert.equal(await verifySession(token, env, now), true);
  assert.equal(await verifySession('authenticated', env, now), false);
  assert.equal(await verifySession(token + 'x', env, now), false);
  assert.equal(await verifySession(token, env, now + 8 * 86400000), false);
  assert.equal(
    await verifySession(token, { ...env, SITE_PASSWORD: 'new-password' }, now),
    false,
  );
  assert.equal(
    await verifySession(undefined, { NODE_ENV: 'production' }),
    false,
  );
  assert.equal(await correctPassword('wrong', 'right'), false);
});

test('public site mode stays usable while private Studio APIs fail closed in production', async () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    SITE_PASSWORD: process.env.SITE_PASSWORD,
  };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', SITE_PASSWORD: '' });
    const response = await middleware(new NextRequest('https://app.example/'));
    assert.equal(response.headers.get('x-middleware-next'), '1');
    await assert.rejects(
      requireStudioSession(
        new NextRequest('https://app.example/api/studio/drafts'),
      ),
      { code: 'session_not_configured' },
    );
  } finally {
    Object.assign(process.env, { NODE_ENV: saved.NODE_ENV });
    if (saved.SITE_PASSWORD === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = saved.SITE_PASSWORD;
  }
});
test('origin validation supports Next localhost canonicalization without accepting foreign origins', () => {
  assert.equal(
    sameRequestOrigin(
      'http://127.0.0.1:3001',
      'http://localhost:3001/api/studio',
      '127.0.0.1:3001',
    ),
    true,
  );
  assert.equal(
    sameRequestOrigin(
      'https://app.example',
      'https://app.example/api/studio',
      'app.example',
    ),
    true,
  );
  assert.equal(
    sameRequestOrigin(
      'https://evil.example',
      'https://app.example/api/studio',
      'app.example',
    ),
    false,
  );
  assert.equal(
    sameRequestOrigin(
      'http://app.example',
      'https://app.example/api/studio',
      'app.example',
    ),
    false,
  );
  assert.equal(
    sameRequestOrigin('null', 'https://app.example/api/studio', 'app.example'),
    false,
  );
});
test('reference URLs reject private, mixed DNS, metadata and transition addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '192.168.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    '2002:7f00:1::',
    '2001:db8::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const url of [
    'http://example.com/a.jpg',
    'https://localhost/a',
    'https://user:pass@example.com/a',
    'https://example.com:444/a',
    'https://127.0.0.1/a',
  ])
    await assert.rejects(publicDestination(url));
  await assert.rejects(
    publicDestination('https://images.example/a', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
  );
});
test('every redirect is validated and excessive redirects stop', async () => {
  const visited: string[] = [];
  const resolve = async (url: string) => {
    visited.push(url);
    if (url.includes('127.0.0.1')) throw new Error('private');
    return { url: new URL(url), address: '8.8.8.8', family: 4 };
  };
  await assert.rejects(
    downloadPublicImage('https://example.com/a', resolve, async () => ({
      status: 302,
      location: 'https://127.0.0.1/a',
      bytes: Buffer.alloc(0),
    })),
  );
  assert.equal(visited.length, 2);
  let calls = 0;
  await assert.rejects(
    downloadPublicImage('https://example.com/a', resolve, async () => {
      calls++;
      return { status: 302, location: '/again', bytes: Buffer.alloc(0) };
    }),
  );
  assert.equal(calls, 4);
});
test('image bytes and actual size determine eligibility, not the extension or filename', async () => {
  const thumbnail = await sharp({
    create: { width: 269, height: 151, channels: 3, background: '#1234ff' },
  })
    .png()
    .toBuffer();
  const normalized = await normalizeReference(thumbnail);
  assert.equal(normalized.eligibleForConditioning, false);
  assert.equal(normalized.width, 269);
  await assert.rejects(normalizeReference(Buffer.from('<svg/>')));
  await assert.rejects(normalizeReference(Buffer.alloc(10 * 1024 * 1024 + 1)));
  await assert.rejects(prepareOutput(thumbnail, 'nano-pro-2k'));
});
test('web candidate deduplication preserves Unicode and only offers HTTPS images', () => {
  const image = {
    url: 'https://example.com/p.png',
    thumbnail: '',
    title: 'പുതിയ AI ഫോൺ',
    source: 'Official',
    sourcePageUrl: 'https://example.com',
  };
  const results = deduplicateCandidates([
    image,
    { ...image },
    { ...image, url: 'http://example.com/other' },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, image.title);
});
