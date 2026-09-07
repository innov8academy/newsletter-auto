import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';

test('an all-used batch returns zero instead of resurrecting stories through the safety net', async (t) => {
  const headline = 'Example launches NewTool 2.0';
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/rest/v1/used_stories')) return Response.json([{ headline }]);
    if (url.includes('generativelanguage.googleapis.com')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { headline, summary: 'A new release.', category: 'tool_launch', baseScore: 9, entities: ['Example'], originalUrl: null }
    ]) }] } }] });
    if (url === 'https://fixture.example/feed') return new Response(`<rss><channel><item><title>${headline}</title><link>https://fixture.example/article</link><pubDate>${new Date().toISOString()}</pubDate><description>${'Product details. '.repeat(50)}</description></item></channel></rss>`);
    return new Response('<rss><channel></channel></rss>');
  });
  const { curateNews } = await import('../src/lib/smart-curator');
  const result = await curateNews('test', undefined, [{ name: 'Fixture', url: 'https://fixture.example/feed', category: 'news' }]);
  assert.equal(result.stats.usedStoryFilteredCount, 1);
  assert.deepEqual(result.stories, []);
  assert.equal(result.stats.safetyNetRecoveredCount, 0);
});
