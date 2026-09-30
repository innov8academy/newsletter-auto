import type { NewsItem } from './types';

const API = 'https://api.huggingnews.com/api/stories';
interface Story { slug: string; title: string; publishedAt: number; summary?: string;
  isSuperseded?: boolean; supersedes?: { slug: string };
  selectedTweets?: Array<{ url?: string; role?: string }> }
function validStory(value: unknown): value is Story {
  if (!value || typeof value !== 'object') return false;
  const s = value as Story;
  return typeof s.slug === 'string' && /^[a-zA-Z0-9-]{1,250}$/.test(s.slug) &&
    typeof s.title === 'string' && s.title.length > 0 && Number.isFinite(s.publishedAt);
}
async function json(url: string, fetcher: typeof fetch, key: string) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000), cache: 'no-store',
    headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!response.ok) throw new Error(`HuggingNews HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('HuggingNews response exceeded the feed limit');
  return JSON.parse(text);
}

/** Public recent feed by default. No pagination, fabricated timestamps or copied full articles. */
export async function fetchHuggingNews(fetcher: typeof fetch = fetch, query = '', key = '', now = Date.now()): Promise<NewsItem[]> {
  const url = new URL(API);
  if (query.trim()) { url.searchParams.set('query', query.trim().slice(0, 200)); url.searchParams.set('limit', '12'); }
  const feed = await json(url.href, fetcher, key);
  const candidates: unknown[] = query.trim() ? feed.stories :
    Array.isArray(feed.dayGroups) ? feed.dayGroups.flatMap((g: { stories?: unknown[] }) => g.stories ?? []) : [];
  if (!Array.isArray(candidates)) throw new Error('HuggingNews response format changed');
  const seen = new Set<string>();
  const recent = candidates.filter(validStory).filter(story => {
    if (seen.has(story.slug) || story.publishedAt > now || now-story.publishedAt > 36*3600000) return false;
    seen.add(story.slug); return true;
  }).sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,12);
  const details: Story[] = [];
  // Bound concurrent source reads. Feed failure never clears the current newsletter.
  for (let i=0;i<recent.length;i+=4) {
    const batch = await Promise.allSettled(recent.slice(i,i+4).map(story => json(API+'/'+story.slug,fetcher,key)));
    batch.forEach(result => { if (result.status==='fulfilled' && validStory(result.value)) details.push(result.value); });
  }
  if (recent.length && !details.length) throw new Error('HuggingNews story details are unavailable');
  const replaced = new Set(details.flatMap(story => story.supersedes?.slug ? [story.supersedes.slug] : []));
  return details.filter(story=>!story.isSuperseded && !replaced.has(story.slug)).map(story=>{
    const url = 'https://huggingnews.com/ai/'+story.slug;
    const primaryLinks = [...new Set((story.selectedTweets ?? []).flatMap(tweet => {
      try { const link = new URL(tweet.url ?? ''); return link.protocol==='https:' ? [link.href] : []; } catch { return []; }
    }))].slice(0,6);
    const summary = typeof story.summary === 'string' ? story.summary.slice(0,600) : '';
    return { id:'huggingnews_'+story.slug,title:story.title,url,source:API,sourceName:'HuggingNews',
      publishedAt:new Date(story.publishedAt).toISOString(),summary,primaryLinks,
      content: `${summary}\nAggregator: ${url}\nSupporting sources:\n${primaryLinks.join('\n')}` };
  });
}
