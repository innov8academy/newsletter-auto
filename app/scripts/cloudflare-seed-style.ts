/** Transfer only the three reviewed L8R style anchors to a private R2 bucket. Dry-run by default. */
import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EDITORIAL_ANCHORS, EDITORIAL_STYLE_SLUG, EDITORIAL_STYLE_VERSION } from '../src/lib/studio/editorial-style';
import { normalizeReference } from '../src/lib/studio/media';
import type { StudioAsset, StylePack } from '../src/lib/studio/types';

type SeedObject = { key: string; bytes: Buffer; mimeType: string; sha256: string };
export type SeedTransferPlan = { packId: string; assetIds: string[]; objects: SeedObject[] };
type SeedStore = {
  putIfAbsent(key: string, bytes: Buffer, mimeType: string): Promise<'created' | 'exists'>;
  get(key: string): Promise<Buffer>;
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function stableId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Small RFC 4180 parser: needed because payload JSON is quoted and may contain commas/newlines. */
export function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') { insist(field === '', 'Malformed CSV quote'); quoted = true; }
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  insist(!quoted, 'Unclosed CSV quote');
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()?.map((x) => x.replace(/^\uFEFF/, ''));
  insist(header && header.length, 'Empty CSV');
  return rows.map((values) => {
    insist(values.length === header.length, 'Malformed CSV row');
    return Object.fromEntries(header.map((name, index) => [name, values[index]]));
  });
}

export async function prepareSeedTransfer(input: {
  recordsCsv: string;
  packsCsv: string;
  selectedDir: string;
}): Promise<SeedTransferPlan> {
  const packRows = parseCsv(input.packsCsv);
  insist(packRows.length === 1, 'Expected exactly one exported style pack');
  const packRecord = JSON.parse(packRows[0].payload) as { id: string; payload: StylePack };
  const pack = packRecord.payload;
  insist(pack.id === packRecord.id && pack.slug === EDITORIAL_STYLE_SLUG && pack.version === EDITORIAL_STYLE_VERSION,
    'Unexpected style pack identity');
  insist(pack.id === stableId(`${EDITORIAL_STYLE_SLUG}:${EDITORIAL_STYLE_VERSION}`), 'Style pack ID does not match seed algorithm');
  const assetRows = parseCsv(input.recordsCsv)
    .filter((row) => row.table_name === 'studio_assets')
    .map((row) => JSON.parse(row.payload) as { id: string; role: string; checksum: string; payload: StudioAsset })
    .filter((row) => row.role === 'style');
  insist(assetRows.length === 3 && pack.assetIds.length === 3 && pack.anchorIds.length === 3,
    'Expected exactly three style assets');
  const assetIds = assetRows.map((row) => row.id);
  insist(new Set(assetIds).size === 3 &&
    pack.assetIds.every((id) => assetIds.includes(id)) &&
    pack.anchorIds.every((id) => assetIds.includes(id)) &&
    new Set(pack.assetIds).size === 3 && new Set(pack.anchorIds).size === 3,
  'Style pack asset membership differs from the three selected anchors');

  const objects: SeedObject[] = [];
  for (const anchor of EDITORIAL_ANCHORS) {
    const matched = assetRows.filter((row) => row.payload.name.includes(anchor.file));
    insist(matched.length === 1, `Missing or duplicate selected anchor ${anchor.prefix}`);
    const row = matched[0], asset = row.payload;
    insist(asset.id === row.id && row.checksum === asset.checksum && asset.draftId === null &&
      asset.role === 'style' && asset.status === 'ready' && asset.eligibleForConditioning &&
      asset.mimeType === 'image/png', `Invalid asset metadata ${anchor.prefix}`);
    const bytes = await readFile(path.join(input.selectedDir, anchor.file));
    const checksum = sha256(bytes);
    insist(checksum === asset.checksum && bytes.length === asset.byteLength, `Original checksum or size mismatch ${anchor.prefix}`);
    insist(asset.id === stableId(`l8r-seed:${checksum}`), `Asset ID mismatch ${anchor.prefix}`);
    const prefix = `styles/${EDITORIAL_STYLE_SLUG}/${asset.id}/`;
    insist(asset.originalPath === `${prefix}original` && asset.conditioningPath === `${prefix}conditioning.jpg`,
      `Object path mismatch ${anchor.prefix}`);
    const normalized = await normalizeReference(bytes);
    insist(normalized.eligibleForConditioning && normalized.checksum === checksum &&
      normalized.mimeType === asset.mimeType && normalized.width === asset.width &&
      normalized.height === asset.height, `Normalized image mismatch ${anchor.prefix}`);
    objects.push({ key: asset.originalPath, bytes, mimeType: asset.mimeType, sha256: checksum });
    objects.push({ key: asset.conditioningPath, bytes: normalized.conditioning, mimeType: 'image/jpeg', sha256: sha256(normalized.conditioning) });
  }
  insist(objects.length === 6 && new Set(objects.map((object) => object.key)).size === 6, 'Expected six distinct objects');
  return { packId: pack.id, assetIds: pack.assetIds, objects };
}

/** Idempotent transfer. A conflicting existing key always stops the run. */
export async function transferSeed(plan: SeedTransferPlan, store: SeedStore): Promise<{ created: number; verified: number }> {
  insist(plan.packId === stableId(`${EDITORIAL_STYLE_SLUG}:${EDITORIAL_STYLE_VERSION}`) &&
    plan.assetIds.length === 3 && new Set(plan.assetIds).size === 3 && plan.objects.length === 6,
  'Invalid transfer plan');
  const keys = new Set(plan.assetIds.flatMap((id) => [
    `styles/${EDITORIAL_STYLE_SLUG}/${id}/original`,
    `styles/${EDITORIAL_STYLE_SLUG}/${id}/conditioning.jpg`,
  ]));
  insist(new Set(plan.objects.map((object) => object.key)).size === 6 &&
    plan.objects.every((object) => keys.has(object.key)), 'Invalid transfer plan');
  for (const object of plan.objects) insist(sha256(object.bytes) === object.sha256, `Local object changed: ${object.key}`);
  let created = 0;
  for (const object of plan.objects) {
    const state = await store.putIfAbsent(object.key, object.bytes, object.mimeType);
    if (state === 'created') created++;
    else {
      insist(state === 'exists', `Unexpected upload state: ${object.key}`);
      const current = await store.get(object.key);
      insist(current.equals(object.bytes), `Existing object differs: ${object.key}`);
    }
  }
  for (const object of plan.objects) {
    const current = await store.get(object.key);
    insist(current.equals(object.bytes) && sha256(current) === object.sha256, `Read-back mismatch: ${object.key}`);
  }
  return { created, verified: plan.objects.length };
}

export function privateR2Config(env: NodeJS.ProcessEnv): { client: S3Client; bucket: string } {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_PRIVATE_BUCKET;
  insist(accountId && /^[a-f0-9]{32}$/i.test(accountId), 'Set R2_ACCOUNT_ID to the explicit account ID');
  insist(accessKeyId && secretAccessKey && bucket && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket),
    'Set explicit R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_PRIVATE_BUCKET');
  return { bucket, client: new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED' }) };
}

export function r2SeedStore(client: S3Client, bucket: string): SeedStore {
  return {
    async putIfAbsent(key, bytes, mimeType) {
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
          ContentType: mimeType, CacheControl: 'private, max-age=3600', IfNoneMatch: '*' }));
        return 'created';
      } catch (error) {
        const code = (error as { name?: string; $metadata?: { httpStatusCode?: number } }).name;
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (code === 'PreconditionFailed' || status === 412) return 'exists';
        throw error;
      }
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      insist(result.Body, `Missing R2 object: ${key}`);
      return Buffer.from(await result.Body.transformToByteArray());
    },
  };
}

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const source = path.resolve(root, '..', 'tmp', 'cloudflare-migration', 'source');
  const plan = await prepareSeedTransfer({
    recordsCsv: await readFile(path.join(source, 'current-studio-records.csv'), 'utf8'),
    packsCsv: await readFile(path.join(source, 'studio-style-packs.csv'), 'utf8'),
    selectedDir: path.join(root, 'studio-seed', 'selected'),
  });
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', packId: plan.packId, assetIds: plan.assetIds,
      objects: plan.objects.map(({ key, bytes, sha256: digest }) => ({ key, bytes: bytes.length, sha256: digest })) }, null, 2));
    return;
  }
  const { client, bucket } = privateR2Config(process.env);
  try {
    const result = await transferSeed(plan, r2SeedStore(client, bucket));
    console.log(JSON.stringify({ mode: 'applied', bucket, ...result }));
  } finally { client.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // SDK errors can include request details. Never echo them during a credentialed run.
    console.error(process.argv.includes('--apply')
      ? 'Seed transfer failed. Inspect the private logs and verify the bucket before retrying.'
      : `Seed validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
