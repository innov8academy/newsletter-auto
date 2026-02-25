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

// Check if a URL is a Reddit feed
function isRedditFeed(url: string): boolean {
    return url.includes('reddit.com') || url.includes('/r/');
}

// Fetch Reddit posts using Jina (bypasses Reddit's blocking)
async function fetchRedditViaJina(feed: RSSFeed): Promise<NewsItem[]> {
    try {
        // Convert RSS URL back to regular Reddit URL for Jina
        const redditUrl = feed.url.replace('/.rss', '').replace('.rss', '');
        console.log(`[Reddit via Jina] Fetching ${feed.name}: ${redditUrl}`);

        const jinaResponse = await fetch(`https://r.jina.ai/${redditUrl}`, {
            headers: {
                'Accept': 'text/plain',
            }
        });

        if (!jinaResponse.ok) {
            console.error(`[Reddit via Jina] Failed for ${feed.name}: ${jinaResponse.status}`);
            return [];
        }

        const markdown = await jinaResponse.text();
        
        // Parse the Jina markdown output to extract posts
        // Jina returns markdown with links and content
        const posts: NewsItem[] = [];
        const lines = markdown.split('\n');
        
        let currentTitle = '';
        let currentUrl = '';
        let currentContent = '';
        
        for (const line of lines) {
            // Match markdown links: [title](url)
            const linkMatch = line.match(/^\[(.+?)\]\((https:\/\/(?:www\.)?reddit\.com\/r\/[^\)]+)\)/);
            if (linkMatch) {
                // Save previous post if exists
                if (currentTitle && currentUrl) {
                    posts.push({
                        id: generateId(currentTitle, currentUrl),
                        title: currentTitle,
                        url: currentUrl,
                        source: feed.url,
                        sourceName: feed.name,
                        publishedAt: new Date().toISOString(),
                        summary: cleanText(currentContent).substring(0, 500),
                        imageUrl: '',
                        author: '',
                        content: cleanText(currentContent),
                    });
                }
                currentTitle = linkMatch[1];
                currentUrl = linkMatch[2];
                currentContent = '';
            } else if (currentTitle && line.trim()) {
                // Accumulate content for current post
                currentContent += ' ' + line;
            }
        }
        
        // Don't forget the last post
        if (currentTitle && currentUrl) {
            posts.push({
                id: generateId(currentTitle, currentUrl),
                title: currentTitle,
                url: currentUrl,
                source: feed.url,
                sourceName: feed.name,
                publishedAt: new Date().toISOString(),
                summary: cleanText(currentContent).substring(0, 500),
                imageUrl: '',
                author: '',
                content: cleanText(currentContent),
            });
        }

        console.log(`[Reddit via Jina] Got ${posts.length} posts from ${feed.name}`);
        return posts.slice(0, 10);
    } catch (error) {
        console.error(`[Reddit via Jina] Error for ${feed.name}:`, error);
        return [];
    }
}

// Parse RSS feed and extract news items
async function parseRSSFeed(feed: RSSFeed): Promise<NewsItem[]> {
    // Use Jina for Reddit feeds (Reddit blocks most RSS requests)
    if (isRedditFeed(feed.url)) {
        return fetchRedditViaJina(feed);
    }

    try {
        const response = await fetch(feed.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
            },
            next: { revalidate: 300 } // Cache for 5 minutes
        });

        if (!response.ok) {
            console.error(`Failed to fetch ${feed.name}: ${response.status}`);
            return [];
        }

        const text = await response.text();

        // Check if response is actually XML (not HTML error page)
        if (text.includes('<!DOCTYPE html>') || text.includes('<html') || text.includes("You've been blocked")) {
            console.error(`[RSS Blocked] ${feed.name} returned HTML instead of RSS`);
            return [];
        }

        const parsed = parser.parse(text);

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

            // Extract summary/description - also check content:encoded (used by some feeds)
            const contentEncoded = item['content:encoded'] || '';
            const summary = item.description?.['#text'] ||
                item.description ||
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
                publishedAt: new Date(pubDate).toISOString(),
                summary: cleanText(bestContent).substring(0, 500),
                imageUrl,
                author: item.author || item['dc:creator'] || '',
                content: cleanText(bestContent), // Store full content for extraction
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

// Fetch AI news from X/Twitter (from newsletter's own Supabase — pushed by bird CLI on EC2)
const X_SOURCE_ID = 'd5ec53f3-063c-4efa-a6b7-f6dd0781aff8';

async function fetchXNews(): Promise<NewsItem[]> {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseKey) {
            console.log('[X News] Supabase not configured, skipping');
            return [];
        }

        console.log('[X News] Fetching from Supabase...');
        const response = await fetch(
            `${supabaseUrl}/rest/v1/news_items?source_id=eq.${X_SOURCE_ID}&order=created_at.desc&limit=10`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                },
                cache: 'no-store',
            }
        );

        if (!response.ok) {
            console.error('[X News] Supabase fetch failed:', response.status);
            return [];
        }

        const items = await response.json();
        console.log(`[X News] Got ${items.length} items from Supabase`);
        
        return items.map((item: any) => {
            // Extract @handle from title (format: "@handle: tweet text")
            const handleMatch = item.title?.match(/^@(\w+):/);
            const author = handleMatch ? handleMatch[1] : 'unknown';
            
            return {
                id: `x_${item.id}`,
                title: item.title || '',
                url: item.url || '',
                source: 'x_twitter',
                sourceName: `X: @${author}`,
                publishedAt: item.published_at || item.created_at || new Date().toISOString(),
                summary: item.raw_summary || item.title || '',
                imageUrl: '',
                author: author,
                content: item.raw_summary || item.title || '',
            };
        });
    } catch (error) {
        console.error('[X News] Error fetching:', error);
        return [];
    }
}

// Fetch news from all configured feeds
export async function fetchAllNews(feeds: RSSFeed[]): Promise<NewsItem[]> {
    const allPromises = feeds.map(feed => parseRSSFeed(feed));
    
    // Also fetch X/Twitter news in parallel
    allPromises.push(fetchXNews());
    
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
