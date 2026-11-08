import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initialize, execute, nextHistoryExpiry, pruneExpiredHistory } from './core.mjs';
import { authorized, dispatch } from './gateway.mjs';
import { ensureHistoryAlarm } from './history-alarm.mjs';

function storage() {
  const sqlite = new DatabaseSync(':memory:');
  const sql = {
    calls: [],
    exec(statement, ...args) {
      this.calls.push(statement);
      const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
      const rows = sqlite.prepare(statement).all(...args);
      const after = sqlite.prepare('SELECT total_changes() AS n').get().n;
      return { toArray: () => rows, rowsWritten: after - before };
    },
  };
  initialize(sql);
  return { sql, transactionSync(fn) {
    sqlite.exec('BEGIN');
    try { const result = fn(); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
const draft = (id = '11111111-1111-4111-8111-111111111111', rev) => ({ studioDraftId: id, ...(rev === undefined ? {} : { studioServerRevision: rev }), stories: [] });
const content = (sessionId, body = null) => ({ sessionId, curatedStories: [], selectedIds: [], researchReports: [], wizardState: null, currentDraft: body });
const call = (s, op, fields = {}) => execute(s, { op, ...fields });

test('archive precedes save, stale revision does not write, and 24 hour history is pruned', () => {
  const s = storage();
  const initial = call(s, 'newsletter_state');
  const first = call(s, 'newsletter_save', { expectedRevision: 0, content: content('edition-1', draft()) });
  assert.equal(first.state.revision, 1);
  assert.equal(first.state.current_draft.studioServerRevision, 1);
  const saved = call(s, 'query', { sql: 'SELECT * FROM newsletter_versions', params: [] }).rows;
  assert.equal(saved.length, 1);
  assert.equal(JSON.parse(saved[0].snapshot).session_id, initial.session_id);
  const stale = call(s, 'newsletter_save', { expectedRevision: 0, content: content('stale') });
  assert.equal(stale.conflict, true);
  assert.equal(call(s, 'query', { sql: 'SELECT count(*) AS n FROM newsletter_versions', params: [] }).rows[0].n, 1);
  s.sql.exec('UPDATE newsletter_versions SET created_at=? WHERE id=?', new Date(Date.now() - 25 * 3600_000).toISOString(), saved[0].id);
  call(s, 'newsletter_save', { expectedRevision: 1, content: content('edition-2', null) });
  const versions = call(s, 'query', { sql: 'SELECT * FROM newsletter_versions', params: [] }).rows;
  assert.equal(versions.length, 1);
  assert.equal(JSON.parse(versions[0].snapshot).current_draft.studioServerRevision, 1);
});

test('simultaneous writes use one revision winner', async () => {
  const s = storage();
  const attempts = await Promise.all([
    Promise.resolve().then(() => call(s, 'newsletter_save', { expectedRevision: 0, content: content('writer-a') })),
    Promise.resolve().then(() => call(s, 'newsletter_save', { expectedRevision: 0, content: content('writer-b') })),
  ]);
  assert.equal(attempts.filter(x => x.state && !x.conflict).length, 1);
  assert.equal(attempts.filter(x => x.conflict).length, 1);
  assert.equal(call(s, 'newsletter_state').revision, 1);
});

test('recovery choice blocks writes, restores chosen body, and protects referenced old version', () => {
  const s = storage();
  const id = '22222222-2222-4222-8222-222222222222';
  const selected = { current_draft: draft(id), wizard_state: null };
  s.sql.exec('INSERT INTO newsletter_versions(id,source,session_id,snapshot,created_at) VALUES(?,?,?,?,?)', id, 'legacy-writing', 'old', JSON.stringify(selected), new Date(Date.now() - 48 * 3600_000).toISOString());
  s.sql.exec('UPDATE shared_news_selection SET draft_choices=? WHERE id=?', JSON.stringify([{ id, source: 'Writing', updatedAt: now() }]), 'default');
  assert.equal(call(s, 'newsletter_save', { expectedRevision: 0, content: content('new') }).choiceRequired, true);
  assert.equal(call(s, 'newsletter_studio_save', { expectedRevision: null, body: draft() }).choiceRequired, true);
  assert.equal(call(s, 'newsletter_save', { expectedRevision: 0, content: content('new'), resolveVersion: id }).state.current_draft.studioDraftId, id);
  assert.equal(call(s, 'newsletter_state').draft_choices.length, 0);
  // On successful resolution, the old choice may be pruned; the archived pre-resolution state remains.
  const archived = call(s, 'query', { sql: "SELECT snapshot FROM newsletter_versions WHERE source='workspace-save'", params: [] }).rows;
  assert.equal(archived.length, 1);
  assert.equal(JSON.parse(archived[0].snapshot).draft_choices[0].id, id);
});

test('alarm cleanup expires old history without a save and preserves recovery, current state, and styles', () => {
  const s = storage();
  const protectedId = '33333333-3333-4333-8333-333333333333';
  const expiredId = '44444444-4444-4444-8444-444444444444';
  const age = new Date(Date.now() - 26 * 3600_000).toISOString();
  call(s, 'newsletter_save', { expectedRevision: 0, content: content('current-session', draft()) });
  s.sql.exec('INSERT INTO studio_style_packs(id,slug,version,payload,active,created_at) VALUES(?,?,?,?,?,?)',
    '55555555-5555-4555-8555-555555555555', 'style', 1, '{}', 1, now());
  for (const id of [protectedId, expiredId])
    s.sql.exec('INSERT INTO newsletter_versions(id,source,session_id,snapshot,created_at) VALUES(?,?,?,?,?)', id, 'workspace-save', 'current-session', '{}', age);
  s.sql.exec("UPDATE shared_news_selection SET draft_choices=? WHERE id='default'", JSON.stringify([{ id: protectedId }]));
  pruneExpiredHistory(s);
  const ids = call(s, 'query', { sql: 'SELECT id FROM newsletter_versions', params: [] }).rows.map(x => x.id);
  assert.equal(ids.includes(protectedId), true);
  assert.equal(ids.includes(expiredId), false);
  assert.equal(call(s, 'newsletter_state').current_draft.studioDraftId, draft().studioDraftId);
  assert.equal(call(s, 'query', { sql: 'SELECT count(*) AS n FROM studio_style_packs', params: [] }).rows[0].n, 1);
});

test('history alarm uses earliest unprotected expiry and avoids replacing an earlier alarm', async () => {
  const s = storage();
  const protectedId = '66666666-6666-4666-8666-666666666666';
  const ordinaryId = '77777777-7777-4777-8777-777777777777';
  const old = new Date(Date.now() - 48 * 3600_000).toISOString();
  const recent = new Date(Date.now() - 3600_000).toISOString();
  s.sql.exec('INSERT INTO newsletter_versions(id,source,session_id,snapshot,created_at) VALUES(?,?,?,?,?)', protectedId, 'workspace-save', 'session', '{}', old);
  s.sql.exec('INSERT INTO newsletter_versions(id,source,session_id,snapshot,created_at) VALUES(?,?,?,?,?)', ordinaryId, 'workspace-save', 'session', '{}', recent);
  s.sql.exec("UPDATE shared_news_selection SET draft_choices=? WHERE id='default'", JSON.stringify([{ id: protectedId }]));
  let alarm = null;
  let scheduled = 0;
  s.getAlarm = async () => alarm;
  s.setAlarm = async due => { alarm = due; scheduled++; };
  assert.equal(nextHistoryExpiry(s), Date.parse(recent) + 24 * 3600_000);
  await ensureHistoryAlarm(s);
  assert.equal(alarm, Date.parse(recent) + 24 * 3600_000);
  await ensureHistoryAlarm(s);
  assert.equal(scheduled, 1);
  alarm -= 1000;
  await ensureHistoryAlarm(s);
  assert.equal(scheduled, 1);
  s.sql.exec('DELETE FROM newsletter_versions WHERE id=?', ordinaryId);
  assert.equal(nextHistoryExpiry(s), null);
});

test('expiry lookup returns one indexed row after protected choices', () => {
  const s = storage();
  const base = Date.now() - 3600_000;
  const ids = [];
  for (let i = 0; i < 200; i++) {
    const id = `88888888-8888-4888-8888-${i.toString(16).padStart(12, '0')}`;
    ids.push(id);
    s.sql.exec('INSERT INTO newsletter_versions(id,source,session_id,snapshot,created_at) VALUES(?,?,?,?,?)',
      id, 'workspace-save', 'session', '{}', new Date(base + i * 1000).toISOString());
  }
  s.sql.exec("UPDATE shared_news_selection SET draft_choices=? WHERE id='default'",
    JSON.stringify(ids.slice(0, 10).map(id => ({ id }))));
  assert.equal(nextHistoryExpiry(s), base + 10_000 + 24 * 3600_000);
  const lookup = s.sql.calls.at(-1);
  assert.match(lookup, /ORDER BY v\.created_at ASC LIMIT 1/);
  assert.doesNotMatch(lookup, /SELECT\s+\*/);
  const plan = s.sql.exec(`EXPLAIN QUERY PLAN ${lookup}`).toArray();
  assert.equal(plan.some(row => String(row.detail).includes('USING COVERING INDEX newsletter_versions_expiry_idx')), true);
});

test('batch rolls back all SQL and studio revision conflict preserves draft', () => {
  const s = storage();
  const d = draft();
  assert.equal(call(s, 'newsletter_studio_save', { body: d, expectedRevision: null }).revision, 1);
  assert.equal(call(s, 'newsletter_studio_save', { body: { ...d, title: 'stale' }, expectedRevision: null }).conflict, true);
  assert.throws(() => call(s, 'batch', { statements: [
    { sql: 'INSERT INTO studio_style_packs(id,slug,version,payload,created_at) VALUES(?,?,?,?,?)', params: ['a', 'style', 1, '{}', now()] },
    { sql: 'INSERT INTO studio_style_packs(id,slug,version,payload,created_at) VALUES(?,?,?,?,?)', params: ['b', 'style', 1, '{}', now()] },
  ] }));
  assert.equal(call(s, 'query', { sql: 'SELECT count(*) AS n FROM studio_style_packs', params: [] }).rows[0].n, 0);
});

test('mandatory token guards worker before Durable Object access', async () => {
  const secret = '0123456789abcdef0123456789abcdef';
  assert.equal(await authorized(`Bearer ${secret}`, secret), true);
  assert.equal(await authorized('Bearer incorrect', secret), false);
  assert.equal(await authorized(`Bearer ${secret}`, 'short'), false);
  let reached = false;
  const env = { INTERNAL_SECRET: secret, L8R_DATA: { idFromName: () => 'id', get: () => ({ fetch: () => { reached = true; return new Response('{}'); } }) } };
  const request = new Request('https://test/internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"op":"health"}' });
  const response = await dispatch(request, env);
  assert.equal(response.status, 401);
  assert.equal(reached, false);
});

function now() { return new Date().toISOString(); }
