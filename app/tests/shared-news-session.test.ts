import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

type Row = {
  id: string;
  session_id: string;
  revision: number;
  curated_stories: unknown[];
  selected_ids: string[];
  research_reports: unknown[];
  wizard_state: unknown | null;
  current_draft: unknown | null;
  updated_at: string;
};

const initialRow = (): Row => ({
  id: 'default',
  session_id: 'session-one',
  revision: 0,
  curated_stories: [],
  selected_ids: [],
  research_reports: [],
  wizard_state: null,
  current_draft: null,
  updated_at: '2026-09-27T00:00:00.000Z',
});

const payload = (expectedRevision = 0, sessionId = 'session-one') => ({
  expectedRevision,
  sessionId,
  curatedStories: [{ id: 'curated-1', headline: 'A valid story' }],
  selectedIds: ['curated-1'],
  researchReports: [{ story: { id: 'custom-1', headline: 'Custom research' }, deepResearch: 'Findings' }],
  wizardState: { selectedReports: [], completed: { stories: [] } },
  currentDraft: { studioDraftId: '11111111-1111-4111-8111-111111111111', title: 'Draft', stories: [{ title: 'Story 1' }] },
});

function mockStore(t: TestContext, initial: Row | null) {
  const store: { row: Row | null; failLoad: boolean; patches: URL[] } = {
    row: initial,
    failLoad: false,
    patches: [],
  };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url.pathname === '/rest/v1/rpc/newsletter_state') {
      if (store.failLoad) return Response.json({ code: 'fixture_error' }, { status: 503 });
      return Response.json(store.row);
    }
    if (url.pathname === '/rest/v1/rpc/newsletter_save') {
      url.searchParams.set('revision', 'eq.' + body.expected_revision); store.patches.push(url);
      if (!store.row || store.row.revision !== body.expected_revision) return Response.json({ conflict: true, state: store.row });
      const c = body.content;
      store.row = { ...store.row, session_id:c.sessionId, revision:store.row.revision+1,
        curated_stories:c.curatedStories,selected_ids:c.selectedIds,research_reports:c.researchReports,
        wizard_state:c.wizardState,current_draft:c.currentDraft,updated_at:'2026-09-30T00:00:00.000Z' };
      return Response.json({state:store.row});
    }
    throw new Error('Unexpected URL: ' + url.pathname);
  });
  return store;
}

async function route() {
  const [{ NextRequest }, handlers] = await Promise.all([
    import('next/server'),
    import('../src/app/api/shared-selection/route'),
  ]);
  const put = (body: unknown) => handlers.PUT(new NextRequest('http://localhost/api/shared-selection', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as NextRequest);
  return { ...handlers, put };
}

test('GET distinguishes an initialized empty session, missing row, and load failure', async t => {
  const store = mockStore(t, initialRow());
  const { GET } = await route();

  const empty = await GET();
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {
    success: true, initialized: true,
    state: {
      sessionId: 'session-one', revision: 0, curatedStories: [], selectedIds: [],
      researchReports: [], wizardState: null, currentDraft: null, draftChoices: [],
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
  });

  store.row = null;
  const missing = await GET();
  assert.deepEqual(await missing.json(), { success: true, initialized: false, state: null });

  store.failLoad = true;
  const failed = await GET();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, 'load_failed');
});

test('every PUT passes the expected revision to the database transaction; a stale writer receives the latest full state', async t => {
  const store = mockStore(t, initialRow());
  const { put } = await route();

  const first = await put(payload());
  assert.equal(first.status, 200);
  const saved = (await first.json()).state;
  assert.equal(saved.revision, 1);
  assert.equal(saved.researchReports[0].story.id, 'custom-1');
  assert.equal(saved.currentDraft.stories[0].title, 'Story 1');
  assert.equal(store.patches[0].searchParams.get('revision'), 'eq.0');

  const stale = await put({ ...payload(), selectedIds: [] });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.code, 'conflict');
  assert.deepEqual(conflict.state, saved);
  assert.deepEqual(store.row?.selected_ids, ['curated-1']);

  const reset = await put({
    ...payload(1, 'session-two'), curatedStories: [], selectedIds: [],
    researchReports: [], wizardState: null, currentDraft: null,
  });
  assert.equal(reset.status, 200);
  const resetState = (await reset.json()).state;
  assert.equal(resetState.sessionId, 'session-two');
  assert.equal(resetState.revision, 2);
  assert.deepEqual(resetState.curatedStories, []);

  const olderDevice = await put(payload(1, 'session-one'));
  assert.equal(olderDevice.status, 409);
  assert.equal((await olderDevice.json()).state.sessionId, 'session-two');
  assert.equal(store.row?.session_id, 'session-two');
});

test('two writers from one revision cannot both save', async t => {
  const store = mockStore(t, initialRow());
  const { put } = await route();
  const [left, right] = await Promise.all([
    put({ ...payload(), sessionId: 'left' }),
    put({ ...payload(), sessionId: 'right' }),
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  assert.equal(store.row?.revision, 1);
  assert.deepEqual(store.patches.map(url => url.searchParams.get('revision')), ['eq.0', 'eq.0']);
});

test('rejects malformed and oversized selections without writing, while allowing 48 curated candidates', async t => {
  const store = mockStore(t, initialRow());
  const { put } = await route();
  const base = payload();
  for (const body of [
    { ...base, researchReports: undefined },
    { ...base, selectedIds: Array.from({ length: 31 }, (_, i) => `id-${i}`) },
    { ...base, researchReports: Array.from({ length: 31 }, () => base.researchReports[0]) },
    { ...base, wizardState: { selectedReports: Array.from({ length: 31 }, () => base.researchReports[0]) } },
    { ...base, currentDraft: { stories: Array.from({ length: 31 }, () => ({ title: 'Story' })) } },
  ]) {
    const response = await put(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_payload');
  }
  assert.equal(store.patches.length, 0);

  const manyCandidates = await put({
    ...base,
    curatedStories: Array.from({ length: 48 }, (_, i) => ({ id: `id-${i}`, headline: `Story ${i}` })),
  });
  assert.equal(manyCandidates.status, 200);
  assert.equal(store.row?.curated_stories.length, 48);
});
