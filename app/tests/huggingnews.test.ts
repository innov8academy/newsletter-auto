import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchHuggingNews } from '../src/lib/huggingnews';
import { baseScore, scoreLabel } from '../src/lib/news-score';

test('HuggingNews uses anonymous bounded reads, original dates, attribution and supporting links; superseded versions are removed', async () => {
  const now = Date.parse('2026-09-30T06:00:00Z');
  const requests: string[] = [];
  const story = (slug: string) => ({slug,title:slug,publishedAt:now-10000});
  const mock: typeof fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(new Headers(init?.headers).has('Authorization'),false);
    if (url.endsWith('/stories')) return Response.json({dayGroups:[{stories:[story('old'),story('new'),story('new'),{...story('ancient'),publishedAt:now-100*3600000}]}]});
    const slug = url.split('/').at(-1)!;
    return Response.json({...story(slug),summary:'Brief public summary',...(slug==='new'?{supersedes:{slug:'old'}}:{}),
      selectedTweets:[{url:'https://x.com/example/status/1',role:'primary'},{url:'javascript:bad()'}]});
  };
  const items = await fetchHuggingNews(mock,'','',now);
  assert.equal(items.length,1);assert.equal(items[0].id,'huggingnews_new');
  assert.equal(items[0].url,'https://huggingnews.com/ai/new');
  assert.equal(items[0].publishedAt,new Date(now-10000).toISOString());
  assert.deepEqual(items[0].primaryLinks,['https://x.com/example/status/1']);
  assert.equal(requests.length,3);
});
test('source failure is explicit and search uses the documented query contract without inventing pagination',async()=>{
  await assert.rejects(fetchHuggingNews(async()=>Response.json({}, {status:429})),/HTTP 429/);
  await fetchHuggingNews(async(input)=>{const url=new URL(String(input));assert.equal(url.searchParams.get('query'),'AI tools');assert.equal(url.searchParams.get('limit'),'12');assert.equal(url.searchParams.has('beforeDayKey'),false);return Response.json({stories:[],truncated:true});},'AI tools');
});
test('score formatting is legible and model strings cannot concatenate with numeric boosts',()=>{
  assert.equal(baseScore('7')+2,9);assert.equal(baseScore('bad'),5);assert.equal(baseScore(Infinity),5);
  assert.equal(baseScore(0),0);assert.equal(scoreLabel(7.333333),'7.3');assert.equal(scoreLabel(NaN),'—');
});
