import assert from 'node:assert/strict';
import test from 'node:test';
import type { CuratedStory } from '../src/lib/types';
import { currentNews, selectNewsCandidates } from '../src/lib/news-freshness';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

test('paraphrased launch headlines match, but different versions and events do not', async () => {
  const { isExcludedStory } = await import('../src/lib/smart-curator');
  assert.equal(isExcludedStory({ headline: 'GPT-6 Astra Debuts: Multimodal Real-Time Interaction Capabilities' },
    ['OpenAI Announces GPT-6 Astra: Next-Gen Multimodal Intelligence']), true);
  assert.equal(isExcludedStory({ headline: 'OpenAI’s Astra model is now generally available for public use' },
    ['OpenAI Announces GPT-6 Astra: Next-Gen Multimodal Intelligence']), true);
  assert.equal(isExcludedStory({ headline: 'GPT-6 Astra Model Announced as Latest AI Milestone' },
    ['OpenAI announces GPT-6 Astra: A new generation of intelligence']), true);
  assert.equal(isExcludedStory({ headline: 'OpenAI begins rollout of GPT-6 Astra model' }, ['GPT-6 Astra Model Now Available']), true);
  assert.equal(isExcludedStory({ headline: 'OpenAI agents hijacked German wiki to coordinate and evade safeguards' }, ['OpenAI agents hijacked a public wiki to communicate in secret']), true);
  assert.equal(isExcludedStory({ headline: 'Anthropic releases Claude Fable 5.2' }, ['Anthropic releases Claude Fable 5.1']), false);
  assert.equal(isExcludedStory({ headline: 'OpenAI GPT-6 Astra faces monitoring challenges' }, ['OpenAI launches GPT-6 Astra']), false);
});

test('restored and merged lists remove stale unselected cards while preserving selected work', () => {
  const story = (id: string, age: number) => ({ id, publishedAt: new Date(Date.now() - age * 3600000).toISOString(), finalScore: 7 }) as CuratedStory;
  assert.deepEqual(currentNews([story('old', 100), story('selected', 100), story('fresh', 2)], ['selected']).map(s => s.id), ['fresh', 'selected']);
});

test('a busy source cannot crowd a quieter official source out of extraction', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: 'News', url: `https://example.com/${i}`, source: 'feed', sourceName: 'Busy', publishedAt: new Date(Date.now() - i * 1000).toISOString() }));
  items.push({ ...items[0], id: 'official', sourceName: 'Official', publishedAt: new Date(Date.now() - 3600000).toISOString() });
  assert.equal(selectNewsCandidates(items, 3).some(item => item.id === 'official'), true);
});

test('article publication metadata never substitutes modification dates', async () => {
  const { articlePublishedAt } = await import('../src/lib/firecrawl');
  assert.equal(articlePublishedAt('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2020-01-01","dateModified":"2026-09-07"}</script>'), '2020-01-01T00:00:00.000Z');
  assert.equal(articlePublishedAt('<meta property="article:modified_time" content="2026-09-07">'), '');
});

test('a fresh newsletter cannot re-date an old event or an undated roundup story', async (t) => {
  const now = new Date().toISOString();
  const content = 'On January 1, 2020, Example launched Model 1. ' + 'Background detail. '.repeat(50);
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { headline: 'Example launches Model 1', summary: 'Old release', category: 'model_release', baseScore: 9, entities: ['Example'], originalUrl: null, eventDate: '2020-01-01', dateEvidence: 'January 1, 2020' },
      { headline: 'Another undated product', summary: 'No date supplied', category: 'tool_launch', baseScore: 9, entities: [], originalUrl: null }
    ]) }] } }] });
    if (url === 'https://fixture.example/feed') return new Response(`<rss><channel><item><title>Daily roundup</title><link>https://fixture.example/roundup</link><pubDate>${now}</pubDate><description>${content}</description></item></channel></rss>`);
    return new Response('<rss><channel></channel></rss>');
  });
  const { curateNews } = await import('../src/lib/smart-curator');
  const result = await curateNews('test', undefined, [{ name: 'Fixture newsletter', url: 'https://fixture.example/feed', category: 'newsletter', tier: 1 }]);
  assert.equal(result.stories.length, 0);
});

test('newsletter links use original reader publication dates without fetching model-selected hosts directly', async (t) => {
  const now = new Date().toISOString();
  const sourceUrl = 'https://publisher.example/new-tool';
  const content = `Read the announcement (${sourceUrl}). ` + 'Article details. '.repeat(50);
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    assert.notEqual(url, sourceUrl, 'Model-selected URLs must go through the reader');
    if (url === `https://r.jina.ai/${sourceUrl}`) return new Response(`Published Time: ${now}\n\nNew tool announcement`);
    if (url.includes('generativelanguage.googleapis.com')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { headline: 'Example launches NewTool 2', summary: 'New release', category: 'tool_launch', baseScore: 9, entities: ['Example'], originalUrl: sourceUrl }
    ]) }] } }] });
    if (url === 'https://fixture.example/feed') return new Response(`<rss><channel><item><title>Daily roundup</title><link>https://fixture.example/roundup</link><pubDate>${now}</pubDate><description>${content}</description></item></channel></rss>`);
    return new Response('<rss><channel></channel></rss>');
  });
  const { curateNews } = await import('../src/lib/smart-curator');
  const result = await curateNews('test', undefined, [{ name: 'Fixture newsletter', url: 'https://fixture.example/feed', category: 'newsletter', tier: 1 }]);
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].dateBasis, 'linked-article');
  assert.equal(result.stories[0].publishedAt, now);
});
