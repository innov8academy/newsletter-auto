import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import type { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { R2ObjectStore, type R2ObjectConfig } from '../src/lib/studio/r2-object-store';
import { uploadReference } from '../src/components/studio/client-api';

const config: R2ObjectConfig = {
  accountId: '1234567890abcdef1234567890abcdef',
  accessKeyId: 'test-key', secretAccessKey: 'test-secret',
  privateBucket: 'private', publicBucket: 'public',
  publicBaseUrl: 'https://images.example.test',
};

test('writes private references and published images to separate buckets', async () => {
  const commands: PutObjectCommand[] = [];
  const client = { send: async (command: PutObjectCommand) => { commands.push(command); return {}; } } as unknown as S3Client;
  const store = new R2ObjectStore(config, { client });
  await store.putObject('references/a.png', Buffer.from('private'), 'image/png');
  await store.putObject('newsletter/a.png', Buffer.from('public'), 'image/png', true);
  assert.deepEqual(commands.map((command) => command.input.Bucket), ['private', 'public']);
  assert.deepEqual(commands.map((command) => command.input.ContentType), ['image/png', 'image/png']);
  assert.equal(store.publicUrl('newsletter/a b.png'), 'https://images.example.test/newsletter/a%20b.png');
  assert.match(commands[0].input.CacheControl!, /private/);
  assert.match(commands[1].input.CacheControl!, /public/);
});

test('reads private objects as bytes and maps read failures', async () => {
  const client = { send: async (command: GetObjectCommand) => {
    assert.equal(command.input.Bucket, 'private');
    return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
  } } as unknown as S3Client;
  assert.deepEqual(await new R2ObjectStore(config, { client }).getObject('references/a.png'), Buffer.from([1, 2, 3]));
  const failing = { send: async () => { throw new Error('not found'); } } as unknown as S3Client;
  await assert.rejects(new R2ObjectStore(config, { client: failing }).getObject('missing'), { code: 'asset_unavailable' });
});

test('presigns private reads and uploads, with safe download names', async () => {
  const calls: Array<{ command: GetObjectCommand | PutObjectCommand; expiresIn: number }> = [];
  const signer = (async (_client, command, options) => {
    calls.push({ command: command as unknown as GetObjectCommand | PutObjectCommand, expiresIn: options!.expiresIn! });
    return 'https://signed.example.test/object';
  }) as typeof getSignedUrl;
  const store = new R2ObjectStore(config, { signer });
  await store.signObject('references/a.png', '../../photo.jpg');
  const ticket = await store.uploadTicket('references/new.png');
  assert.deepEqual(ticket, { signedUrl: 'https://signed.example.test/object', token: '', path: 'references/new.png' });
  assert.equal(calls[0].command.input.Bucket, 'private');
  assert.equal((calls[0].command as GetObjectCommand).input.ResponseContentDisposition, 'attachment; filename="photo.jpg"');
  assert.equal(calls[0].expiresIn, 3600);
  assert.ok(calls[1].command instanceof PutObjectCommand);
  assert.equal(calls[1].command.input.Bucket, 'private');
  assert.equal((calls[1].command as PutObjectCommand).input.IfNoneMatch, '*');
  assert.equal(calls[1].expiresIn, 600);
  await store.signObject('a', '";evil.jpg');
  assert.equal((calls[2].command as GetObjectCommand).input.ResponseContentDisposition, 'attachment; filename="__evil.jpg"');
  await assert.rejects(store.signObject('a', '..'), { code: 'invalid_download_name' });
});

test('actual presigned PUT requires create-once header and permits browser Content-Type', async () => {
  const store = new R2ObjectStore(config);
  const url = new URL((await store.uploadTicket('references/new.png')).signedUrl);
  assert.equal(url.host, `${config.accountId}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, '/private/references/new.png');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host;if-none-match');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  assert.ok(url.searchParams.has('X-Amz-Signature'));
});

test('rejects invalid paths and configuration without network calls', async () => {
  const store = new R2ObjectStore(config);
  for (const path of ['/private', 'a/../b', 'a\\b', 'a//b']) {
    assert.throws(() => store.publicUrl(path), { code: 'invalid_asset_path' });
  }
  assert.throws(() => new R2ObjectStore({ ...config, publicBucket: 'private' }), { code: 'storage_not_configured' });
  assert.throws(() => new R2ObjectStore({ ...config, accountId: 'wrong-account' }), { code: 'storage_not_configured' });
  assert.throws(() => new R2ObjectStore({ ...config, publicBaseUrl: 'http://example.test' }), { code: 'storage_not_configured' });
});

test('readiness checks both buckets and maps failures', async () => {
  const buckets: string[] = [];
  const client = { send: async (command: HeadBucketCommand) => { buckets.push(command.input.Bucket!); return {}; } } as unknown as S3Client;
  await new R2ObjectStore(config, { client }).checkReady();
  assert.deepEqual(buckets, ['private', 'public']);
  const failing = { send: async () => { throw new Error('no bucket'); } } as unknown as S3Client;
  await assert.rejects(new R2ObjectStore(config, { client: failing }).checkReady(), { code: 'storage_not_ready' });
});

test('browser sends signed create-once header to R2 and keeps Supabase upload header', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const backend of ['r2', 'supabase']) {
      const requests: Array<{ input: string; init?: RequestInit }> = [];
      const signedUrl = backend === 'r2'
        ? (await new R2ObjectStore(config).uploadTicket('uploads/test/source')).signedUrl
        : 'https://storage.example.test/object?token=legacy';
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        if (String(input).endsWith('/references/uploads')) return Response.json({ assetId: 'test', signedUrl });
        if (String(input).endsWith('/references/finalize')) return Response.json({ asset: { id: 'test' } });
        return new Response(null, { status: 200 });
      };
      await uploadReference(new File(['image'], 'test.png', { type: 'image/png' }), 'style', null);
      const upload = requests[1];
      assert.equal(upload.input, signedUrl);
      assert.equal(upload.init?.method, 'PUT');
      assert.deepEqual(upload.init?.headers, backend === 'r2'
        ? { 'Content-Type': 'image/png', 'If-None-Match': '*' }
        : { 'Content-Type': 'image/png', 'x-upsert': 'false' });
      assert.equal(requests.length, 3);
    }
  } finally { globalThis.fetch = originalFetch; }
});
