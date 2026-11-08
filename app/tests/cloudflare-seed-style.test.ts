import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parseCsv, prepareSeedTransfer, transferSeed, privateR2Config, type SeedTransferPlan } from '../scripts/cloudflare-seed-style';

const root = process.cwd();
const privateSourceDir = path.resolve(root, '..', 'tmp', 'cloudflare-migration', 'source');
const hasPrivateExport = ['current-studio-records.csv', 'studio-style-packs.csv']
  .every((name) => existsSync(path.join(privateSourceDir, name))) &&
  existsSync(path.join(root, 'studio-seed', 'selected'));
async function sources() {
  const dir = privateSourceDir;
  return {
    recordsCsv: await readFile(path.join(dir, 'current-studio-records.csv'), 'utf8'),
    packsCsv: await readFile(path.join(dir, 'studio-style-packs.csv'), 'utf8'),
    selectedDir: path.join(root, 'studio-seed', 'selected'),
  };
}

test('CSV parser handles quoted commas, escaped quotes, and line breaks', () => {
  assert.deepEqual(parseCsv('name,payload\r\na,"{ ""name"": ""x,y"" }"\r\nb,"line 1\nline 2"\r\n'), [
    { name: 'a', payload: '{ "name": "x,y" }' }, { name: 'b', payload: 'line 1\nline 2' },
  ]);
  assert.throws(() => parseCsv('a,b\n"unclosed,b'), /Unclosed CSV/);
});

test('validates the real exported metadata and exactly three selected originals offline', { skip: !hasPrivateExport && 'Private source export is unavailable' }, async () => {
  const plan = await prepareSeedTransfer(await sources());
  assert.match(plan.packId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
  assert.equal(plan.assetIds.length, 3);
  assert.equal(plan.objects.length, 6);
  assert.equal(new Set(plan.objects.map((item) => item.key)).size, 6);
  assert.ok(plan.objects.every((item) => item.key.startsWith('styles/l8r-editorial-v2/')));
  assert.equal(plan.objects.filter((item) => item.key.endsWith('/original')).length, 3);
});

test('rejects changed checksums, paths, or pack membership before upload', { skip: !hasPrivateExport && 'Private source export is unavailable' }, async () => {
  const source = await sources();
  const rows = parseCsv(source.recordsCsv);
  const index = rows.findIndex((row) => row.table_name === 'studio_assets');
  assert.ok(index >= 0);
  const original = JSON.parse(rows[index].payload);
  const changed = structuredClone(original);
  changed.payload.checksum = '0'.repeat(64);
  const badRecords = source.recordsCsv.replace(rows[index].payload.replaceAll('"', '""'), JSON.stringify(changed).replaceAll('"', '""'));
  await assert.rejects(prepareSeedTransfer({ ...source, recordsCsv: badRecords }), /checksum|metadata/i);

  const changedPath = structuredClone(original);
  changedPath.payload.conditioningPath = 'styles/other/conditioning.jpg';
  const badPathRecords = source.recordsCsv.replace(rows[index].payload.replaceAll('"', '""'), JSON.stringify(changedPath).replaceAll('"', '""'));
  await assert.rejects(prepareSeedTransfer({ ...source, recordsCsv: badPathRecords }), /Object path mismatch/);

  const packRows = parseCsv(source.packsCsv);
  const pack = JSON.parse(packRows[0].payload);
  pack.payload.assetIds[0] = 'other-id';
  const badPack = source.packsCsv.replace(packRows[0].payload.replaceAll('"', '""'), JSON.stringify(pack).replaceAll('"', '""'));
  await assert.rejects(prepareSeedTransfer({ ...source, packsCsv: badPack }), /membership/i);
});

test('conditional transfer verifies existing bytes and reads all six back', { skip: !hasPrivateExport && 'Private source export is unavailable' }, async () => {
  const plan = await prepareSeedTransfer(await sources());
  const objects = new Map<string, Buffer>();
  const store = {
    async putIfAbsent(key: string, bytes: Buffer) {
      if (objects.has(key)) return 'exists' as const;
      objects.set(key, Buffer.from(bytes)); return 'created' as const;
    },
    async get(key: string) { return Buffer.from(objects.get(key) || []); },
  };
  assert.deepEqual(await transferSeed(plan, store), { created: 6, verified: 6 });
  assert.deepEqual(await transferSeed(plan, store), { created: 0, verified: 6 });
  objects.set(plan.objects[1].key, Buffer.from('different'));
  await assert.rejects(transferSeed(plan, store), /Existing object differs/);
});

test('tampered plan fails closed', { skip: !hasPrivateExport && 'Private source export is unavailable' }, async () => {
  const plan = await prepareSeedTransfer(await sources());
  const tampered: SeedTransferPlan = { ...plan, objects: plan.objects.map((item, index) =>
    index ? item : { ...item, bytes: Buffer.from('changed') }) };
  let calls = 0;
  await assert.rejects(transferSeed(tampered, { putIfAbsent: async () => { calls++; return 'created'; }, get: async () => Buffer.alloc(0) }), /Local object changed/);
  assert.equal(calls, 0);
});

test('missing explicit R2 configuration fails closed', () => {
  assert.throws(() => privateR2Config({} as NodeJS.ProcessEnv), /explicit account ID/);
});
