import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CloudflareStudioRepository } from '../src/lib/studio/cloudflare-repository';
import type { R2ObjectStore } from '../src/lib/studio/r2-object-store';
import type { StudioDraft, StoryWorkspace, GenerationRun, StylePack } from '../src/lib/studio/types';

function harness() {
  const requests: Record<string, unknown>[] = [];
  const replies: unknown[] = [];
  const data = async <T>(request: Record<string, unknown>): Promise<T> => {
    requests.push(request);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply as T;
  };
  const objects = {
    checkReady: async () => {}, putObject: async () => {}, getObject: async () => Buffer.from('private'),
    signObject: async () => 'https://signed.example.test',
    uploadTicket: async (path: string) => ({ signedUrl: 'https://signed.example.test', token: '', path }),
    publicUrl: (path: string) => `https://public.example.test/${path}`,
  } as unknown as R2ObjectStore;
  return { repo: new CloudflareStudioRepository(data, objects), requests, replies };
}

test('draft save uses transactional Worker RPC and decodes rows', async () => {
  const { repo, requests, replies } = harness();
  const draft = { studioDraftId: crypto.randomUUID(), stories: [] } as unknown as StudioDraft;
  replies.push({ id: draft.studioDraftId, payload: draft, revision: 1, updated_at: '2026-11-08T00:00:00Z' });
  const saved = await repo.saveDraft(draft, null);
  assert.equal(saved.revision, 1);
  assert.deepEqual(requests[0], { op: 'newsletter_studio_save', body: draft, expectedRevision: null });
  replies.push({ conflict: true });
  await assert.rejects(repo.saveDraft(draft, 1), { code: 'revision_conflict' });
  replies.push({ choiceRequired: true });
  await assert.rejects(repo.saveDraft(draft, 1), { code: 'draft_recovery_required' });
});

test('workspace save encodes JSON and checks optimistic revision', async () => {
  const { repo, requests, replies } = harness();
  const work = { draftId: 'draft', storyId: 'story', revision: 1, references: [] } as unknown as StoryWorkspace;
  replies.push({ rows: [], changes: 1 });
  const saved = await repo.saveWorkspace(work, 1);
  assert.equal(saved.revision, 2);
  const request = requests[0];
  assert.match(request.sql as string, /WHERE draft_id=\? AND story_id=\? AND revision=\?/);
  assert.equal(JSON.parse((request.params as string[])[0]).revision, 2);
  replies.push({ rows: [], changes: 0 });
  await assert.rejects(repo.saveWorkspace(work, 1), { code: 'revision_conflict' });
});

test('generation claim preserves idempotency and rejects reused IDs', async () => {
  const { repo, requests, replies } = harness();
  const run = { id: 'run', draftId: 'draft', storyId: 'story', requestHash: 'hash', status: 'running', startedAt: 'now' } as GenerationRun;
  replies.push({ rows: [], changes: 1 });
  assert.equal((await repo.claimGeneration(run)).claimed, true);
  assert.match(requests[0].sql as string, /INSERT OR IGNORE/);
  replies.push({ rows: [], changes: 0 }, { rows: [{ payload: JSON.stringify(run) }], changes: 0 });
  assert.deepEqual(await repo.claimGeneration(run), { claimed: false, run });
  replies.push({ rows: [], changes: 0 }, { rows: [{ payload: JSON.stringify({ ...run, requestHash: 'other' }) }], changes: 0 });
  await assert.rejects(repo.claimGeneration(run), { code: 'request_conflict' });
});

test('style insertion detects duplicate and active flag is boolean', async () => {
  const { repo, requests, replies } = harness();
  const pack = { id: 'pack', slug: 'test', version: 1, createdAt: 'now', active: false } as StylePack;
  replies.push({ rows: [], changes: 0 });
  await assert.rejects(repo.insertStyle(pack), { code: 'style_version_conflict' });
  replies.push({ rows: [{ payload: JSON.stringify(pack), active: 1 }], changes: 0 });
  assert.equal((await repo.listStyles())[0].active, true);
  replies.push({ activePackId: 'pack' });
  await repo.activateStyle('pack');
  assert.deepEqual(requests.at(-1), { op: 'activate_style', packId: 'pack' });
});

test('object operations delegate without exposing private references via public URL', async () => {
  const { repo, replies } = harness();
  assert.deepEqual(await repo.getObject('references/private.png'), Buffer.from('private'));
  assert.equal(await repo.signObject('references/private.png'), 'https://signed.example.test');
  assert.equal(repo.publicUrl('newsletter/public.png'), 'https://public.example.test/newsletter/public.png');
  replies.push({ ready: true });
  await repo.checkReady();
});

test('asset lookups split more than 100 IDs into bounded SQL queries', async () => {
  const { repo, requests, replies } = harness();
  const ids = Array.from({ length: 205 }, (_, index) => `asset-${index}`);
  replies.push(
    { rows: [{ payload: JSON.stringify({ id: 'asset-0' }) }], changes: 0 },
    { rows: [{ payload: JSON.stringify({ id: 'asset-100' }) }], changes: 0 },
    { rows: [{ payload: JSON.stringify({ id: 'asset-200' }) }], changes: 0 },
  );
  const assets = await repo.getAssets(ids);
  assert.deepEqual(assets.map((asset) => asset.id), ['asset-0', 'asset-100', 'asset-200']);
  assert.deepEqual(requests.map((request) => (request.params as string[]).length), [100, 100, 5]);
  assert.deepEqual(requests.flatMap((request) => request.params as string[]), ids);
});
