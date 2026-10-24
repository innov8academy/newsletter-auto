import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/research/route';

const story = {
  id: 'research-fixture',
  headline: 'A verified AI release',
  summary: 'Research the official release details.',
  category: 'AI',
  baseScore: 5,
  finalScore: 5,
  entities: [],
  originalUrl: 'https://example.com/release',
  sources: ['Official announcement'],
  publishedAt: '2026-10-24T00:00:00Z',
  crossSourceCount: 1,
  boosts: [],
};

test('research API reports the resolved budget model and actual OpenRouter cost', async () => {
  const previousFetch = globalThis.fetch;
  const previousGoogleKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-google-key';
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    if (!url.startsWith('https://openrouter.ai/')) {
      return Response.json({ error: { message: 'prepayment credits depleted' } }, { status: 402 });
    }
    return Response.json({
      model: 'google/gemini-3.1-flash-lite',
      usage: { cost: 0.01825 },
      choices: [{ message: { content: '## What Happened\nVerified release.\n\n## Key Details\n- Available today.\n\n## Sources\nhttps://example.com/release' } }],
    });
  }) as typeof fetch;
  try {
    const response = await POST(new NextRequest('http://localhost/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story, apiKey: 'fixture-openrouter-key', modelId: 'budget/gemini-grounded' }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.model, 'google/gemini-3.1-flash-lite');
    assert.equal(result.cost, 0.01825);
    assert.equal(result.costBasis, 'provider');
    assert.equal(result.report.story.id, story.id);
    assert.deepEqual(requests, ['https://openrouter.ai/api/v1/chat/completions']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGoogleKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGoogleKey;
  }
});

test('default research uses the budget model and missing provider cost stays unknown', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    choices: [{ message: { content: '## What Happened\nVerified information.\n\n## Sources\nhttps://example.com/release' } }],
  })) as typeof fetch;
  try {
    const response = await POST(new NextRequest('http://localhost/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story, apiKey: 'fixture-openrouter-key' }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.model, 'google/gemini-3.1-flash-lite');
    assert.equal(result.cost, null);
    assert.equal(result.costBasis, 'unknown');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
