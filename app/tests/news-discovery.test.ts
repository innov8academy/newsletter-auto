import assert from 'node:assert/strict';
import test from 'node:test';

// Never read production credentials or call providers in regression tests.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const fetchAllNews: typeof import('../src/lib/news-fetcher').fetchAllNews = async (feeds) =>
  (await import('../src/lib/news-fetcher')).fetchAllNews(feeds);
const feed = { name: 'Fixture', url: 'https://example.com/feed', category: 'news' };
const item = (title: string, date?: string) => `<item><title>${title}</title><link>https://example.com/${title}</link>${date ? `<pubDate>${date}</pubDate>` : ''}<description>Article summary</description></item>`;
const rss = (items: string) => `<rss version="2.0"><channel>${items}</channel></rss>`;

test('undated, invalid and future articles cannot enter the fresh batch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(rss(
    item('fresh', new Date().toISOString()) + item('undated') + item('invalid', 'no-date') +
    item('future', new Date(Date.now() + 86400000).toISOString())
  )));
  const result = await fetchAllNews([feed]);
  assert.deepEqual(result.items.map(i => i.title), ['fresh']);
});

test('blocked feeds are failed rather than reported as empty', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Rate limited', { status: 429 }));
  const result = await fetchAllNews([feed]);
  assert.equal(result.feedHealth[0].status, 'failed');
  assert.match(result.feedHealth[0].error!, /429/);
});

test('fresh entries after ten old entries are still collected', async (t) => {
  const old = Array.from({ length: 12 }, (_, i) => item(`old-${i}`, '2020-01-01')).join('');
  t.mock.method(globalThis, 'fetch', async () => new Response(rss(old + item('fresh', new Date().toISOString()))));
  assert.deepEqual((await fetchAllNews([feed])).items.map(i => i.title), ['fresh']);
});

test('HTML inside RSS article content is not a blocked feed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(rss(item('fresh', new Date().toISOString()).replace('Article summary', '<![CDATA[Example code: <html>]]>'))));
  assert.equal((await fetchAllNews([feed])).items.length, 1);
});

test('an empty valid feed is not a source failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(rss('')));
  assert.equal((await fetchAllNews([feed])).feedHealth[0].status, 'empty');
});

test('Atom article content and evidence links survive parsing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(`<feed><entry><title>New tool</title><published>${new Date().toISOString()}</published><link rel="self" href="https://example.com/api"/><link rel="alternate" href="https://example.com/article"/><content type="html">&lt;a href="https://example.com/source"&gt;Source details&lt;/a&gt;</content></entry></feed>`));
  const result = await fetchAllNews([feed]);
  assert.equal(result.items[0].url, 'https://example.com/article');
  assert.match(result.items[0].content!, /Source details.*https:\/\/example.com\/source/);
});

test('an indexed fallback retains the source identity and reports degraded coverage', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
    String(input) === feed.url ? new Response('blocked', { status: 403 }) : new Response(rss(item('fresh', new Date().toISOString()))));
  const result = await fetchAllNews([{ ...feed, fallbackUrl: 'https://example.org/index' }]);
  assert.equal(result.items[0].source, feed.url);
  assert.equal(result.feedHealth[0].fallbackUsed, true);
  assert.match(result.feedHealth[0].error!, /403/);
});

test('Anthropic news uses dated entries and ignores undated navigation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(`<html><a href="/news/fresh"><time datetime="${new Date().toISOString()}">Today</time><h4>Fresh release</h4></a><a href="/news/old"><time>Jan 1, 2020</time><h4>Old release</h4></a><a href="/news">News</a></html>`));
  const result = await fetchAllNews([{ name: 'Anthropic', url: 'https://www.anthropic.com/news', category: 'blog', format: 'anthropic-news' }]);
  assert.deepEqual(result.items.map(i => i.title), ['Fresh release']);
});
