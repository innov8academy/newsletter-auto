import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SharedSessionClient } from '../src/lib/shared-session-client';
import type { SharedSelectionState } from '../src/lib/storage';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

const story = (id: string) => ({ id, headline: `Story ${id}`, summary: `Summary ${id}`,
  category: 'AI', baseScore: 1, finalScore: 1, entities: [], originalUrl: null,
  sources: [], publishedAt: '2026-09-27T00:00:00Z', crossSourceCount: 1, boosts: [] });
const report = (id: string) => ({ story: story(id), deepResearch: `Research ${id}`,
  keyPoints: [], implications: '', sources: [] });
const empty = (): SharedSelectionState => ({ sessionId: 'session-one', revision: 0,
  curatedStories: [], selectedIds: [], researchReports: [], wizardState: null,
  currentDraft: null, updatedAt: '2026-09-27T00:00:00Z' });

function fakeApi(t: TestContext, initial = empty()) {
  const api = { state: initial, gets: 0, puts: 0, getStatus: 200, putStatus: 200,
    beforePut: null as null | ((body: Record<string, unknown>) => Promise<void>) };
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== 'PUT') {
      api.gets++;
      if (api.getStatus !== 200) return Response.json({ success: false, error: 'Load failed' }, { status: api.getStatus });
      return Response.json({ success: true, initialized: true, state: structuredClone(api.state) });
    }
    api.puts++;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (api.beforePut) await api.beforePut(body);
    if (api.putStatus !== 200) return Response.json({ success: false, error: 'Sign in again to continue.', code: 'unauthenticated' }, { status: api.putStatus });
    if (body.expectedRevision !== api.state.revision) {
      return Response.json({ success: false, code: 'conflict', error: 'Changed elsewhere', state: structuredClone(api.state) }, { status: 409 });
    }
    if (api.state.draftChoices?.length && !body.resolveVersion)
      return Response.json({success:false,code:'recovery_required',error:'Review preserved newsletter',state:structuredClone(api.state)},{status:409});
    const { expectedRevision: _revision, resolveVersion: _choice, ...content } = body;
    if (_choice) content.draftChoices = [];
    api.state = { ...content, revision: api.state.revision + 1,
      updatedAt: new Date().toISOString() } as SharedSelectionState;
    return Response.json({ success: true, state: structuredClone(api.state) });
  });
  return api;
}

test('authoritative empty session replaces stale local queue and preserves legacy work', async t => {
  const api = fakeApi(t);
  const local = memoryStorage({
    innov8_curated_stories: JSON.stringify([story('old')]),
    innov8_selected_ids: JSON.stringify(['old']),
    innov8_research_reports: JSON.stringify([report('old')]),
    currentDraft: JSON.stringify({ title: 'Older draft', stories: [] }),
  });
  const client = new SharedSessionClient(local, 'device-b');
  await client.load();
  assert.equal(client.getSnapshot().phase, 'ready');
  assert.deepEqual(client.getSnapshot().state?.selectedIds, []);
  assert.deepEqual(JSON.parse(local.getItem('innov8_research_reports')!), []);
  assert.match(local.getItem('newsletter_legacy_backup')!, /Older draft/);
  assert.equal(api.puts, 0);
});

test('pre-session curation and selection survive as a downloadable backup', async t => {
  fakeApi(t);
  const local = memoryStorage({
    innov8_curated_stories: JSON.stringify([story('old')]),
    innov8_selected_ids: JSON.stringify(['old']),
  });
  const client = new SharedSessionClient(local, 'legacy-queue');
  await client.load();
  const backup = JSON.parse(client.legacyBackup()!);
  assert.deepEqual(backup.selectedIds, ['old']);
  assert.equal(backup.curatedStories[0].headline, 'Story old');
  assert.equal(client.getSnapshot().legacyAvailable, true);
  assert.deepEqual(client.getSnapshot().state?.selectedIds, []);
});

test('two independent devices resume reports, ordered wizard subset, draft identity and body', async t => {
  const api = fakeApi(t);
  const left = new SharedSessionClient(memoryStorage(), 'left');
  const right = new SharedSessionClient(memoryStorage({
    innov8_selected_ids: JSON.stringify(['older']),
    innov8_research_reports: JSON.stringify([report('older')]),
    'newsletter-wizard-state': JSON.stringify({ selectedReports: [report('older')] }),
  }), 'right');
  await left.load();
  await right.load();
  const chosen = [report('b'), report('a')];
  const wizardState = { schemaVersion: 2, currentStep: 4, currentStoryIndex: 0,
    selectedReports: chosen, reportSignature: 'b|a', completed: { hook: { title: 'Saved hook', subtitle: '' },
      intro: null, toc: null, stories: [{ title: 'Written body' }], summary: null, memeIdeas: [] } };
  const currentDraft = { studioDraftId: '11111111-1111-4111-8111-111111111111', title: 'Saved hook',
    date: 'September 27, 2026', subtitle: '', intro: '', toc: [], quickSummary: '', rawMarkdown: '', memeIdeas: [],
    stories: [{ sourceStoryId: 'b', studioStoryId: '22222222-2222-4222-8222-222222222222', title: 'Written body',
      emoji: 'AI', hookParagraph: 'Original text', bulletPoints: ['Point'], whyItMatters: '', l8rsTake: '' }] };
  left.mutate({ curatedStories: [story('a'), story('b')], selectedIds: ['a', 'b'],
    researchReports: [report('a'), report('b')], wizardState, currentDraft });
  assert.equal(await left.waitForSaved(), true);
  await right.load();
  assert.equal(right.getSnapshot().state?.wizardState && (right.getSnapshot().state!.wizardState as typeof wizardState).selectedReports[0].story.id, 'b');
  assert.equal(right.getSnapshot().state?.currentDraft?.studioDraftId, currentDraft.studioDraftId);
  assert.equal(right.getSnapshot().state?.currentDraft?.stories[0].hookParagraph, 'Original text');
  assert.equal(api.puts, 1);
});

test('failed initial GET never uploads old cache; 401 PUT keeps pending changes for retry', async t => {
  const api = fakeApi(t);
  const local = memoryStorage({ innov8_selected_ids: JSON.stringify(['old']) });
  const client = new SharedSessionClient(local, 'one');
  api.getStatus = 503;
  await client.load();
  assert.equal(client.getSnapshot().phase, 'load_error');
  assert.equal(api.puts, 0);
  assert.deepEqual(JSON.parse(local.getItem('innov8_selected_ids')!), ['old']);
  api.getStatus = 200;
  await client.retry();
  api.putStatus = 401;
  client.mutate({ curatedStories: [story('new')], selectedIds: ['new'] });
  assert.equal(await client.waitForSaved(), false);
  assert.equal(client.getSnapshot().phase, 'auth');
  assert.equal(client.getSnapshot().pending, true);
  api.putStatus = 200;
  await client.retry();
  assert.equal(await client.waitForSaved(), true);
  assert.deepEqual(api.state.selectedIds, ['new']);
});

test('stale device conflicts after reset and cannot resurrect cleared session', async t => {
  const api = fakeApi(t);
  const first = new SharedSessionClient(memoryStorage(), 'first');
  const stale = new SharedSessionClient(memoryStorage(), 'stale');
  await first.load();
  await stale.load();
  first.reset();
  assert.equal(await first.waitForSaved(), true);
  stale.mutate({ curatedStories: [story('old')], selectedIds: ['old'] });
  assert.equal(await stale.waitForSaved(), false);
  assert.equal(stale.getSnapshot().phase, 'conflict');
  stale.replaceShared();
  assert.equal(stale.getSnapshot().phase, 'conflict');
  stale.useLatest();
  assert.deepEqual(stale.getSnapshot().state?.selectedIds, []);
  assert.deepEqual(api.state.selectedIds, []);
});

test('serial saves keep the newer local edit after a delayed first response', async t => {
  const api = fakeApi(t);
  const client = new SharedSessionClient(memoryStorage(), 'one');
  await client.load();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  api.beforePut = async () => { if (api.puts === 1) await gate; };
  client.mutate({ curatedStories: [story('a')], selectedIds: ['a'] });
  const firstSave = client.flush();
  client.mutate({ curatedStories: [story('a'), story('b')], selectedIds: ['a', 'b'] });
  release();
  await firstSave;
  assert.equal(await client.waitForSaved(), true);
  assert.deepEqual(api.state.selectedIds, ['a', 'b']);
  assert.equal(api.state.revision, 2);
});

test('malformed legacy report is backed up, and the 30 story boundary rejects without truncation', async t => {
  fakeApi(t);
  const local = memoryStorage({ innov8_research_reports: '[null,{"story":{"id":"broken"}}]' });
  const client = new SharedSessionClient(local, 'one');
  await client.load();
  assert.match(client.legacyBackup()!, /reportsRaw/);
  const thirtyOne = Array.from({ length: 31 }, (_, index) => `id-${index}`);
  assert.throws(() => client.mutate({ selectedIds: thirtyOne }), /at most 30/);
  assert.deepEqual(client.getSnapshot().state?.selectedIds, []);
});

const choices = [{id:'11111111-1111-4111-8111-111111111111',source:'Writing',updatedAt:'2026-09-30T00:00:00Z'}];
const pendingKey = (tab: string) => 'newsletter_shared_pending_' + tab;
const recoveryCopies = (local: Storage) => Array.from({length:local.length},(_,i)=>local.key(i)).filter(key=>key?.startsWith('newsletter_recovery_'));

test('a leftover pending marker with only revision differences loads cloud without a false conflict or PUT', async t => {
  const server={...empty(),revision:4};const api=fakeApi(t,server);
  const local=memoryStorage({[pendingKey('old-marker')]:JSON.stringify({baseSessionId:'session-one',expectedRevision:0,state:empty()})});
  const client=new SharedSessionClient(local,'old-marker');await client.load();
  assert.equal(client.getSnapshot().phase,'ready');assert.equal(client.getSnapshot().pending,false);
  assert.equal(local.getItem(pendingKey('old-marker')),null);assert.equal(api.puts,0);
  assert.equal(recoveryCopies(local).length,1);
});

test('a pending copy with no user edits adopts a newer cloud newsletter without overwriting it', async t => {
  const base=empty(),server={...empty(),sessionId:'new-session',revision:5,selectedIds:['new'],curatedStories:[story('new')]};
  const api=fakeApi(t,server);const local=memoryStorage({[pendingKey('unchanged')]:JSON.stringify({base,baseSessionId:base.sessionId,expectedRevision:0,state:base})});
  const client=new SharedSessionClient(local,'unchanged');await client.load();
  assert.equal(client.getSnapshot().phase,'ready');assert.equal(client.getSnapshot().state?.sessionId,'new-session');
  assert.equal(api.puts,0);assert.deepEqual(api.state.selectedIds,['new']);
});

test('migration choices pause old pending saves and preserve unsent edits until an explicit choice', async t => {
  const base=empty(),localState={...empty(),selectedIds:['local'],curatedStories:[story('local')]};
  const api=fakeApi(t,{...empty(),draftChoices:choices});
  const local=memoryStorage({[pendingKey('migration')]:JSON.stringify({base,baseSessionId:base.sessionId,expectedRevision:0,state:localState})});
  const client=new SharedSessionClient(local,'migration');await client.load();await client.flush();
  assert.equal(client.getSnapshot().phase,'recovery');assert.equal(api.puts,0);
  assert.match(client.pendingCopy()!,/Story local/);assert.deepEqual(client.getSnapshot().state?.draftChoices,choices);
  assert.throws(()=>client.mutate({selectedIds:[]}),/Load the latest/);
  assert.throws(()=>client.resolveDraftChoice('unknown'),/Choose an available/);
  client.resolveDraftChoice(choices[0].id);assert.equal(await client.waitForSaved(),true);
  assert.equal(api.puts,1);assert.equal(recoveryCopies(local).length,1);
  assert.match(local.getItem(recoveryCopies(local)[0]!)!,/Story local/);
  assert.deepEqual(api.state.draftChoices,[]);
});

test('a recovery response is never retried as an ordinary merge conflict', async t => {
  const api=fakeApi(t);const client=new SharedSessionClient(memoryStorage(),'recovery-race');await client.load();
  client.mutate({selectedIds:['local'],curatedStories:[story('local')]});api.state={...api.state,draftChoices:choices};
  assert.equal(await client.waitForSaved(),false);assert.equal(client.getSnapshot().phase,'recovery');
  await client.retry();await client.flush();assert.equal(api.puts,1);
  assert.match(client.pendingCopy()!,/Story local/);
});

test('loading latest backs up genuine local changes and does not reset or write cloud data', async t => {
  const api=fakeApi(t,{...empty(),sessionId:'cloud-session',revision:5});
  const localState={...empty(),selectedIds:['local'],curatedStories:[story('local')]};
  const local=memoryStorage({[pendingKey('genuine')]:JSON.stringify({baseSessionId:'session-one',expectedRevision:0,state:localState})});
  const client=new SharedSessionClient(local,'genuine');await client.load();
  assert.equal(client.getSnapshot().phase,'conflict');assert.doesNotMatch(client.getSnapshot().message,/another device/i);
  client.useLatest();assert.equal(client.getSnapshot().phase,'ready');assert.equal(api.puts,0);
  assert.equal(api.state.sessionId,'cloud-session');assert.match(local.getItem(recoveryCopies(local)[0]!)!,/Story local/);
});
