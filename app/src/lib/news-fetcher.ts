import { NewsItem, RSSFeed } from './types';
import { XMLParser } from 'fast-xml-parser';

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
async function parseRSSFeed(feed: RSSFeed): Promise<NewsItem[]> {
    try {
        const response = await fetch(feed.url, {
            headers: {
                'User-Agent': 'InnovateAI-Newsletter/1.0',
            },
            next: { revalidate: 300 } // Cache for 5 minutes
        });

        if (!response.ok) {
            console.error(`Failed to fetch ${feed.name}: ${response.status}`);
            return [];
        }

        const xml = await response.text();
        const parsed = parser.parse(xml);

        // Handle both RSS 2.0 and Atom formats
        const items = parsed.rss?.channel?.item || parsed.feed?.entry || [];
        const itemsArray = Array.isArray(items) ? items : [items];

        return itemsArray.slice(0, 10).map((item: any) => {
            const title = item.title?.['#text'] || item.title || 'Untitled';
            const url = item.link?.['@_href'] || item.link || '';
            const pubDate = item.pubDate || item.published || item.updated || new Date().toISOString();

            // Extract image from content or media
            let imageUrl = '';
            if (item['media:content']?.['@_url']) {
                imageUrl = item['media:content']['@_url'];
            } else if (item.enclosure?.['@_url']) {
                imageUrl = item.enclosure['@_url'];
            }

            // Extract summary/description
            const summary = item.description?.['#text'] ||
                item.description ||
                item.summary?.['#text'] ||
                item.summary ||
                '';

            return {
                id: generateId(title, url),
                title: cleanText(title),
                url: typeof url === 'string' ? url : url?.['#text'] || '',
                source: feed.url,
                sourceName: feed.name,
                publishedAt: new Date(pubDate).toISOString(),
                summary: cleanText(summary).substring(0, 300),
                imageUrl,
                author: item.author || item['dc:creator'] || '',
            };
        });
    } catch (error) {
        console.error(`Error parsing ${feed.name}:`, error);
        return [];
    }
}

// Clean HTML tags and decode entities
function cleanText(text: string): string {
    if (!text) return '';
    return text
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

// Fetch news from all configured feeds
export async function fetchAllNews(feeds: RSSFeed[]): Promise<NewsItem[]> {
    const allPromises = feeds.map(feed => parseRSSFeed(feed));
    const results = await Promise.all(allPromises);

    const allNews = results.flat();

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

    return deduplicated;
}

// Filter news by date (last N days)
export function filterByDate(items: NewsItem[], days: number = 7): NewsItem[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return items.filter(item =>
        new Date(item.publishedAt) >= cutoff
    );
}
