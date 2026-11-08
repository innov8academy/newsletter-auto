import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.L8R_STORAGE_BACKEND = 'cloudflare';
process.env.L8R_DATA_URL = 'https://example.workers.dev/internal';
process.env.L8R_DATA_SECRET = 'a'.repeat(40);

test('legacy reads and writes stay on the server worker contract', async () => {
  const { recentNewsletters, usedHeadlines, insertUsedStories, replaceXCache, cachedXRows } = await import('../src/lib/legacy-data');
  const seen: Record<string, any>[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    seen.push(body);
    const result = body.op === 'batch' ? body.statements.map(() => ({ rows: [], changes: 1 }))
      : body.sql.includes('past_newsletters') ? { rows: [{ content_text: 'Example', file_name: 'old.html', imported_at: '2026-11-08T00:00:00Z' }], changes: 0 }
      : body.sql.includes('used_stories') ? { rows: [{ headline: 'Used story' }], changes: 0 }
      : { rows: [{ id: 'id', title: 'Tweet', url: 'https://x.com/a', raw_summary: '{}', published_at: null, created_at: '2026-11-08T00:00:00Z', source_id: 'source' }], changes: 0 };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await recentNewsletters())[0].file_name, 'old.html');
    assert.deepEqual(await usedHeadlines('2026-11-01T00:00:00Z'), ['Used story']);
    assert.equal(await insertUsedStories([{ headline: 'New', url: null, used_at: '2026-11-08T00:00:00Z' }]), 1);
    await replaceXCache('source', [{ source_id: 'source', url: 'https://x.com/a', title: 'Tweet', raw_summary: '{}', published_at: '2026-11-08T00:00:00Z', is_processed: false }]);
    assert.equal((await cachedXRows('source'))[0].id, 'id');
    assert.equal(seen[3].op, 'batch');
    assert.match(seen[3].statements[0].sql, /^DELETE FROM news_items/);
    assert.match(seen[3].statements[1].sql, /ON CONFLICT\(url\) DO NOTHING/);
    assert.equal(seen[0].params[0], 2);
  } finally { global.fetch = originalFetch; }
});

test('Cloudflare selection fails closed without a complete server configuration', async () => {
  const { legacyDataConfigured } = await import('../src/lib/legacy-data');
  const secret = process.env.L8R_DATA_SECRET;
  delete process.env.L8R_DATA_SECRET;
  try { assert.throws(() => legacyDataConfigured(), /not configured/); }
  finally { process.env.L8R_DATA_SECRET = secret; }
});

test('oversized X cache is rejected before a partial replacement', async () => {
  const { replaceXCache } = await import('../src/lib/legacy-data');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = (async () => { calls++; throw new Error('Unexpected worker request'); }) as typeof fetch;
  const row = { source_id: 'source', url: 'https://x.com/a', title: 'Tweet', raw_summary: '{}', published_at: '2026-11-08T00:00:00Z', is_processed: false };
  try {
    await assert.rejects(replaceXCache('source', Array.from({ length: 100 }, () => row)), /Too many X items/);
    await assert.rejects(replaceXCache('other', [row]), /source mismatch/);
    assert.equal(calls, 0);
  } finally { global.fetch = originalFetch; }
});
