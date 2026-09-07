import { defaultConfig } from '../src/lib/config';
import { fetchAllNews } from '../src/lib/news-fetcher';

// Read-only source check: no generation, database writes, or X refresh.
async function main() {
  if (process.argv.includes('--curate')) {
    const { curateNews } = await import('../src/lib/smart-curator');
    const result = await curateNews('server');
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
    return;
  }
  const result = await fetchAllNews(defaultConfig.rssFeeds);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(),
    count: result.items.length, feeds: result.feedHealth,
    items: result.items.map(item => ({ title: item.title, source: item.sourceName, publishedAt: item.publishedAt, url: item.url }))
  }, null, 2));
}
main().catch(() => { console.error('News source audit failed'); process.exitCode = 1; });
