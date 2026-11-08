import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

process.env.L8R_STORAGE_BACKEND = 'cloudflare';
process.env.L8R_DATA_URL = 'http://localhost:8787/internal';
process.env.L8R_DATA_SECRET = '0123456789abcdef0123456789abcdef';

const choiceId = '11111111-1111-4111-8111-111111111111';
const recentId = '22222222-2222-4222-8222-222222222222';
const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
const recent = new Date().toISOString();
const row = () => ({ id: 'default', session_id: 'session', revision: 1,
  curated_stories: [], selected_ids: [], research_reports: [], wizard_state: null,
  current_draft: null, draft_choices: [{ id: choiceId, source: 'Writing', updatedAt: old }],
  updated_at: recent });

test('Cloudflare shared route sends metadata and maps recovery conflict', async t => {
  const requests: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${process.env.L8R_DATA_SECRET}`);
    return Response.json({ ok: true, result: request.op === 'newsletter_save'
      ? { choiceRequired: true, state: row() } : row() });
  });
  const routes = await import('../src/app/api/shared-selection/route');
  const got = await routes.GET();
  assert.equal(got.status, 200);
  assert.equal((await got.json()).state.draftChoices[0].id, choiceId);
  const put = await routes.PUT(new NextRequest('http://localhost/api/shared-selection', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      expectedRevision: 1, sessionId: 'session', curatedStories: [], selectedIds: [],
      researchReports: [], wizardState: null, currentDraft: null,
    }),
  }));
  assert.equal(put.status, 409);
  assert.equal((await put.json()).code, 'recovery_required');
  assert.equal(requests[1].op, 'newsletter_save');
  assert.equal(requests[1].expectedRevision, 1);
  assert.equal((requests[1].content as { sessionId: string }).sessionId, 'session');
});

test('Cloudflare versions show recent snapshots and protected older choice', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { op: string; sql?: string; params?: string[] };
    if (request.op === 'newsletter_state') return Response.json({ ok: true, result: row() });
    if (request.sql?.includes('WHERE id=?')) return Response.json({ ok: true, result: {
      rows: request.params?.[0] === choiceId ? [{ source: 'legacy-writing', created_at: old, snapshot: '{"current_draft":null}' }] : [], changes: 0,
    } });
    if (request.sql?.includes('created_at >= ?')) return Response.json({ ok: true, result: {
      rows: [{ id: recentId, source: 'workspace-save', created_at: recent }], changes: 0,
    } });
    return Response.json({ ok: true, result: { rows: [{ id: choiceId, source: 'legacy-writing', created_at: old }], changes: 0 } });
  });
  const list = await import('../src/app/api/newsletter/versions/route');
  const detail = await import('../src/app/api/newsletter/versions/[id]/route');
  const response = await list.GET();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).versions.map((x: { id: string }) => x.id), [recentId, choiceId]);
  const recovered = await detail.GET(new Request(`http://localhost/api/newsletter/versions/${choiceId}`), { params: Promise.resolve({ id: choiceId }) });
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json()).snapshot, { current_draft: null });
  const missing = await detail.GET(new Request('http://localhost/api/newsletter/versions/33333333-3333-4333-8333-333333333333'),
    { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) });
  assert.equal(missing.status, 404);
});

test('recovery history queries stay within the Durable Object parameter limit', async t => {
  const ids = Array.from({ length: 101 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${i.toString(16).padStart(12, '0')}`);
  const batchSizes: number[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { op: string; sql?: string; params?: string[] };
    if (request.op === 'newsletter_state') return Response.json({ ok: true, result: {
      ...row(), draft_choices: ids.map(id => ({ id, source: 'Writing', updatedAt: old })),
    } });
    if (request.sql?.includes('created_at >= ?')) return Response.json({ ok: true, result: { rows: [], changes: 0 } });
    batchSizes.push(request.params?.length ?? 0);
    return Response.json({ ok: true, result: { rows: request.params?.map(id => ({ id, source: 'Writing', created_at: old })) ?? [], changes: 0 } });
  });
  const { GET } = await import('../src/app/api/newsletter/versions/route');
  const result = await GET();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).versions.length, 101);
  assert.deepEqual(batchSizes, [100, 1]);
});

test('selected Cloudflare backend fails closed without a valid URL or secret', async t => {
  const { cloudflareConfigured, callL8RData } = await import('../src/lib/cloudflare-data');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not call fetch'); });
  const original = process.env.L8R_DATA_URL;
  process.env.L8R_DATA_URL = 'https://example.com/not-internal';
  try {
    assert.equal(cloudflareConfigured(), false);
    await assert.rejects(callL8RData({ op: 'health' }), { code: 'configuration_error' });
  } finally { process.env.L8R_DATA_URL = original; }
});
