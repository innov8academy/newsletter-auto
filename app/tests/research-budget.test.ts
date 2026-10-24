import assert from 'node:assert/strict';
import test from 'node:test';
import { generateResearchReport, BUDGET_RESEARCH_MODEL, DEFAULT_RESEARCH_MODEL } from '../src/lib/researcher';
import type { CuratedStory } from '../src/lib/types';

const story: CuratedStory = {
  id: 'story-1', headline: 'Acme launches an AI editor', summary: 'A new editor for creators.',
  category: 'AI Tools', baseScore: 8, finalScore: 8, entities: ['Acme'],
  originalUrl: 'https://acme.example/launch', sources: ['Acme'],
  publishedAt: '2026-10-24T00:00:00Z', crossSourceCount: 1, boosts: [],
};
const markdown = '## What Happened\nAcme launched an editor.\n\n## Key Details\n- It edits video.\n\n## Why It Matters\nCreators can test it.\n\n## Sources\nAcme';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function withFetch(fetcher: typeof fetch, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = previous; }
}

test('default budget mode uses OpenRouter native search and retains cited URLs and usage cost', async () => {
  assert.equal(DEFAULT_RESEARCH_MODEL, 'budget/gemini-grounded');
  assert.equal(BUDGET_RESEARCH_MODEL, 'google/gemini-3.1-flash-lite');
  const calls: Array<{ url: string; body: Record<string, unknown>; key: string | null }> = [];
  await withFetch((async (input, init) => {
    const url = String(input);
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    calls.push({ url, body: JSON.parse(init?.body as string), key: new Headers(init?.headers).get('Authorization') });
    return json({ choices: [{ message: {
      content: markdown,
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://source.example/article', title: 'Source' } },
        { type: 'url_citation', url_citation: { url: 'javascript:alert(1)' } },
        { type: 'url_citation', url_citation: { url: 'https://source.example/article' } },
      ],
    } }], usage: { cost: 0.0075 } });
  }) as typeof fetch, async () => {
    const result = await generateResearchReport(story, 'openrouter-test-key', undefined, 'creator pricing');
    assert.equal(result.success, true);
    assert.equal(result.model, BUDGET_RESEARCH_MODEL);
    assert.equal(result.cost, 0.0075);
    assert.deepEqual(result.report?.sources, ['Acme', 'https://source.example/article']);
    assert.match(result.report?.deepResearch || '', /https:\/\/source\.example\/article/);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'Bearer openrouter-test-key');
  assert.equal(calls[0].body.model, BUDGET_RESEARCH_MODEL);
  assert.deepEqual(calls[0].body.tools, [{ type: 'openrouter:web_search', parameters: { engine: 'native' } }]);
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.max_tokens, 4000);
  assert.deepEqual(calls[0].body.reasoning, { effort: 'low', exclude: true });
  assert.match(JSON.stringify(calls[0].body.messages), /creator pricing/);
  assert.equal(calls[0].body.plugins, undefined);
});

test('legacy grounded ID stays valid without a Google key; missing provider cost remains null', async () => {
  const prior = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await withFetch((async (input) => {
      assert.match(String(input), /openrouter\.ai/);
      return json({ choices: [{ message: { content: markdown } }], usage: {} });
    }) as typeof fetch, async () => {
      const result = await generateResearchReport(story, 'key', 'budget/gemini-grounded');
      assert.equal(result.success, true);
      assert.equal(result.cost, null);
    });
  } finally {
    if (prior !== undefined) process.env.GEMINI_API_KEY = prior;
  }
});

test('Serper mode searches first, then synthesizes once without native search duplication', async () => {
  let searchCalls = 0;
  let providerCalls = 0;
  await withFetch((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/web-search')) {
      searchCalls++;
      return json({ success: true, results: [{ type: 'news', title: 'Launch', snippet: 'Official news', source: 'Acme', url: 'https://acme.example/news' }] });
    }
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    providerCalls++;
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, BUDGET_RESEARCH_MODEL);
    assert.equal(body.tools, undefined);
    assert.match(JSON.stringify(body.messages), /https:\/\/acme\.example\/news/);
    return json({ choices: [{ message: { content: markdown } }], usage: { cost: 0.002 } });
  }) as typeof fetch, async () => {
    const result = await generateResearchReport(story, 'key', 'budget/serper-gemini');
    assert.equal(result.success, true);
    assert.equal(result.cost, 0.002);
    assert.ok(result.report?.sources.includes('https://acme.example/news'));
  });
  assert.equal(searchCalls, 3);
  assert.equal(providerCalls, 1);
});

test('Serper mode stops before paid synthesis when searches have no usable results', async () => {
  let providerCalls = 0;
  await withFetch((async (input) => {
    if (String(input).endsWith('/api/web-search')) return json({ success: true, results: [] });
    providerCalls++;
    throw new Error('unexpected provider call');
  }) as typeof fetch, async () => {
    const result = await generateResearchReport(story, 'key', 'budget/serper-gemini');
    assert.equal(result.success, false);
    assert.equal(result.report, undefined);
  });
  assert.equal(providerCalls, 0);
});

test('budget provider failures are safe, actionable and never produce a report', async () => {
  for (const status of [401, 402, 429]) {
    let calls = 0;
    await withFetch((async () => {
      calls++;
      return json({ error: { message: 'PRIVATE upstream key and body' } }, status);
    }) as typeof fetch, async () => {
      const result = await generateResearchReport(story, 'key', 'budget/gemini-grounded');
      assert.equal(result.success, false);
      assert.equal(result.report, undefined);
      assert.match(result.error || '', /OpenRouter/);
      assert.doesNotMatch(result.error || '', /PRIVATE/);
    });
    assert.equal(calls, 1);
  }
  for (const body of [
    { error: { message: 'PRIVATE embedded error' } },
    { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { content: [{ type: 'text', text: 'text only' }] } }] },
    { choices: [{ finish_reason: 'length', message: { content: markdown } }] },
  ]) {
    let calls = 0;
    await withFetch((async () => { calls++; return json(body); }) as typeof fetch, async () => {
      const result = await generateResearchReport(story, 'key', 'budget/gemini-grounded');
      assert.equal(result.success, false);
      assert.equal(result.report, undefined);
      assert.doesNotMatch(result.error || '', /PRIVATE/);
    });
    assert.equal(calls, 1);
  }
  await withFetch((async () => new Response('{broken json', { status: 200 })) as typeof fetch, async () => {
    const result = await generateResearchReport(story, 'key', 'budget/gemini-grounded');
    assert.equal(result.success, false);
    assert.equal(result.report, undefined);
    assert.match(result.error || '', /OpenRouter/);
  });
});
