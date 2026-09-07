import { NewsItem, RSSFeed, FeedHealth } from './types';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { isFreshNews, normalizeNewsDate } from './news-freshness';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
});

// Generate unique ID for news items
function generateId(title: string, url: string): string {
    const str = `${title}-${url}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Parse RSS feed and extract news items
// Resolve Google News redirect URLs to actual article URLs
async function resolveGoogleNewsUrl(googleUrl: string): Promise<string> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(googleUrl, {
            redirect: 'manual',
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
        });
        clearTimeout(timeout);
        const location = response.headers.get('location');
        if (location && !location.includes('news.google.com')) {
            return location;
        }
    } catch { /* return original on failure */ }
    return googleUrl;
}

function isGoogleNewsFeed(url: string): boolean {
    return url.includes('news.google.com');
}

async function fetchAnthropicNews(feed: RSSFeed): Promise<NewsItem[]> {
    const response = await fetch(feed.url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const items: NewsItem[] = [];
    const seen = new Set<string>();
    $('a[href]').each((_, element) => {
        const anchor = $(element);
        const time = anchor.find('time').first();
        const publishedAt = normalizeNewsDate(time.attr('datetime') || time.text());
        if (!publishedAt) return;
        const url = new URL(anchor.attr('href')!, feed.url).href;
        if (new URL(url).hostname !== 'www.anthropic.com' || seen.has(url)) return;
        const title = anchor.find('h2,h3,h4,[class*="title"]').first().text().trim();
        if (!title) return;
        seen.add(url);
        items.push({ id: generateId(title, url), title, url, source: feed.url,
            sourceName: feed.name, publishedAt, summary: anchor.find('p').text().trim() });
    });
    if (!items.length) throw new Error('No dated news entries found; source markup may have changed');
    return items.filter(item => isFreshNews(item.publishedAt))
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 20);
}

async function parseRSSFeed(feed: RSSFeed): Promise<NewsItem[]> {
    if (feed.format === 'anthropic-news') return fetchAnthropicNews(feed);

    try {

        const response = await fetch(feed.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
            },
            signal: AbortSignal.timeout(10000),
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();

        const parsed = parser.parse(text);
        if (!(parsed.rss && 'channel' in parsed.rss) && !('feed' in parsed)) {
            throw new Error('Source returned non-feed content (blocked or invalid XML)');
        }

        // Handle both RSS 2.0 and Atom formats
        const items = parsed.rss?.channel?.item || parsed.feed?.entry || [];
        const itemsArray = Array.isArray(items) ? items : [items];

        const rawItems = itemsArray.map((item: any) => {
            const title = item.title?.['#text'] || item.title || 'Untitled';
            const links = (Array.isArray(item.link) ? item.link : [item.link]) as Array<string | Record<string, string>>;
            const link = links.find(l => typeof l !== 'string' && l?.['@_rel'] === 'alternate') ||
                links.find(l => typeof l === 'string' || !l?.['@_rel']) || links[0];
            const url = typeof link === 'string' ? link : link?.['@_href'] || link?.['#text'] || '';
            const pubDate = item.pubDate || item.published || item.updated || '';

            // Extract image from content or media
            let imageUrl = '';
            if (item['media:content']?.['@_url']) {
                imageUrl = item['media:content']['@_url'];
            } else if (item.enclosure?.['@_url']) {
                imageUrl = item.enclosure['@_url'];
            }

            // Extract summary/description - also check content:encoded (used by some feeds)
            const contentEncoded = item['content:encoded'] || '';
            const summary = item.description?.['#text'] ||
                item.description ||
                item.content?.['#text'] || item.content ||
                item.summary?.['#text'] ||
                item.summary ||
                '';

            // Use content:encoded if available and longer than summary
            const bestContent = contentEncoded.length > summary.length ? contentEncoded : summary;

            return {
                id: generateId(title, url),
                title: cleanText(title),
                url: typeof url === 'string' ? url : url?.['#text'] || '',
                source: feed.url,
                sourceName: feed.name,
                publishedAt: normalizeNewsDate(pubDate),
                summary: cleanText(bestContent).substring(0, 500),
                imageUrl,
                author: item.author || item['dc:creator'] || '',
                content: cleanText(bestContent), // Store full content for extraction
            };
        });

        // Filter before the per-source cap; a malformed item must not lose the whole feed.
        const eligibleItems = rawItems.filter(item => isFreshNews(item.publishedAt))
            .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 20);

        // Resolve Google News redirect URLs to real article URLs (in parallel)
        if (isGoogleNewsFeed(feed.url)) {
            const resolved = await Promise.allSettled(
                eligibleItems.map(async (item) => {
                    const realUrl = await resolveGoogleNewsUrl(item.url);
                    if (realUrl !== item.url) {
                        console.log(`[Google News] Resolved: ${item.title.substring(0, 40)}... → ${new URL(realUrl).hostname}`);
                    }
                    return { ...item, url: realUrl };
                })
            );
            return resolved
                .filter((r) => r.status === 'fulfilled')
                .map(r => (r as PromiseFulfilledResult<typeof rawItems[number]>).value);
        }

        return eligibleItems;
    } catch (error) {
        throw error;
    }
}

// Clean HTML tags and decode entities
function cleanText(text: string): string {
    if (typeof text !== 'string' || !text) return '';
    return text
        .replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#8216;/g, "'")
        .replace(/&#8217;/g, "'")
        .replace(/&#8220;/g, '"')
        .replace(/&#8221;/g, '"')
        .replace(/&#8211;/g, '–')
        .replace(/&#8212;/g, '—')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#\d+;/g, '') // Remove any remaining numeric entities
        .trim();
}

// Fetch AI news from X/Twitter (from Supabase cache — populated by X API v2)
import { getCachedXNews } from './x-api';

async function fetchXNews(): Promise<NewsItem[]> {
    try {
        console.log('[X News] Fetching cached X API v2 data...');
        const tweets = await getCachedXNews();
        console.log(`[X News] Got ${tweets.length} items from cache`);

        return tweets.map(t => {
            // Parse engagement data for content enrichment
            const engagementInfo = t.engagement_score > 0
                ? ` [${t.likes} likes, ${t.retweets} RTs]`
                : '';

            return {
                id: `x_${t.id}`,
                title: `@${t.author_username}: ${t.text.split('\n')[0].substring(0, 180)}`,
                url: t.url,
                source: 'x_twitter',
                sourceName: `X: @${t.author_username}`,
                publishedAt: t.created_at,
                summary: t.text + engagementInfo,
                imageUrl: '',
                author: t.author_username,
                content: t.text,
            };
        });
    } catch (error) {
        console.error('[X News] Error fetching:', error);
        return [];
    }
}

// Fetch news from all configured feeds (with feed health tracking)
export async function fetchAllNews(feeds: RSSFeed[]): Promise<{ items: NewsItem[], feedHealth: FeedHealth[] }> {
    const feedHealth: FeedHealth[] = [];

    const allPromises = feeds.map(async (feed) => {
        const start = Date.now();
        try {
            const items = await parseRSSFeed(feed);
            const latencyMs = Date.now() - start;
            feedHealth.push({
                name: feed.name,
                status: items.length > 0 ? 'ok' : 'empty',
                itemCount: items.length,
                latencyMs,
            });
            return items;
        } catch (error) {
            if (feed.fallbackUrl) {
                try {
                    const items = await parseRSSFeed({ ...feed, url: feed.fallbackUrl, format: 'rss', fallbackUrl: undefined });
                    feedHealth.push({ name: feed.name, status: items.length ? 'ok' : 'empty',
                        itemCount: items.length, latencyMs: Date.now() - start, fallbackUsed: true,
                        error: `Direct feed: ${error instanceof Error ? error.message : 'unavailable'}; using Google News index` });
                    return items.map(item => ({ ...item, source: feed.url }));
                } catch { /* Record the direct source failure below. */ }
            }
            const latencyMs = Date.now() - start;
            feedHealth.push({
                name: feed.name,
                status: 'failed',
                itemCount: 0,
                latencyMs,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    });

    const results = await Promise.all(allPromises);
    const allNews = results.flat();

    // Log feed health summary
    const ok = feedHealth.filter(f => f.status === 'ok').length;
    const empty = feedHealth.filter(f => f.status === 'empty').length;
    const failed = feedHealth.filter(f => f.status === 'failed');
    console.log(`[Feed Health] ${ok} OK, ${empty} empty, ${failed.length} FAILED${failed.length > 0 ? ': ' + failed.map(f => f.name).join(', ') : ''}`);

    // Sort by date (newest first)
    allNews.sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    // Deduplicate by title similarity
    const seen = new Set<string>();
    const deduplicated = allNews.filter(item => {
        const normalized = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });

    // Keep items from the last 24 hours by default, with adaptive fallback to 36h
    const cutoff24h = new Date();
    cutoff24h.setHours(cutoff24h.getHours() - 24);

    const filterByDate = (items: typeof deduplicated, cutoff: Date) =>
        items.filter(item => {
            const pubDate = new Date(item.publishedAt);
            if (!isFreshNews(item.publishedAt)) return false;
            return pubDate >= cutoff;
        });

    let fresh = filterByDate(deduplicated, cutoff24h);

    // Adaptive fallback: if too few items with 24h window, expand to 36h
    if (fresh.length < 10) {
        const cutoff36h = new Date();
        cutoff36h.setHours(cutoff36h.getHours() - 36);
        fresh = filterByDate(deduplicated, cutoff36h);
        console.log(`[News] ${deduplicated.length} total → ${fresh.length} from last 36h (adaptive fallback, 24h had <10 items)`);
    } else {
        console.log(`[News] ${deduplicated.length} total → ${fresh.length} from last 24h (dropped ${deduplicated.length - fresh.length} stale)`);
    }

    return { items: fresh, feedHealth };
}

// Filter news by date (last N days)
export function filterByDate(items: NewsItem[], days: number = 7): NewsItem[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return items.filter(item =>
        new Date(item.publishedAt) >= cutoff
    );
}
