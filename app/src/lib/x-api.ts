import TwitterApi from 'twitter-api-v2';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { callGemini } from './gemini-client';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface XTweet {
    id: string;
    text: string;
    author_username: string;
    author_name: string;
    created_at: string;
    url: string;
    linked_urls: string[]; // URLs embedded in the tweet (articles, products, etc.)
    likes: number;
    retweets: number;
    impressions: number;
    engagement_score: number; // likes + retweets*2
    source_method: 'search' | 'context_search' | 'news_api' | 'community';
    // AI-cleaned fields (from Gemini post-processing)
    cleaned_title?: string;
    cleaned_summary?: string;
    ai_relevant?: boolean; // false = spam/irrelevant, filtered out
}

export interface XFetchResult {
    tweets: XTweet[];
    cached: boolean;
    fetched_at: string;
    api_calls_made: number;
    errors: string[];
}

interface NewsStory {
    title: string;
    summary: string;
    category: string;
    url: string;
    related_tweets: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const X_SOURCE_ID = 'd5ec53f3-063c-4efa-a6b7-f6dd0781aff8';
const CACHE_TTL_MINUTES = 30;

// Tweet fields we request from every search
const TWEET_FIELDS = ['created_at', 'public_metrics', 'author_id', 'entities'] as const;
const USER_FIELDS = ['username', 'name'] as const;
const EXPANSIONS = ['author_id'] as const;

// ─── Client ────────────────────────────────────────────────────────────────────

function getClient(): TwitterApi {
    let token = process.env.X_BEARER_TOKEN;
    if (!token || token === 'your_bearer_token_here') {
        throw new Error('[X API] X_BEARER_TOKEN not configured. Get one from developer.x.com');
    }
    // Decode URL-encoded characters (e.g. %3D → =) in case token was pasted with encoding
    token = decodeURIComponent(token);
    return new TwitterApi(token);
}

// ─── Helper: parse tweets from API response ────────────────────────────────────

function parseTweets(
    result: any,
    sourceMethod: XTweet['source_method']
): XTweet[] {
    // The SDK returns a paginator. The raw response is in .data
    // .data has { data: Tweet[], includes: { users: [] }, meta: {} }
    const response = result?.data || result;
    const tweets = response?.data || response;

    // Handle case where tweets is not an array
    if (!Array.isArray(tweets)) {
        console.log(`[X API] parseTweets: no tweets array found (got ${typeof tweets})`);
        return [];
    }

    // Build author lookup from includes
    const authors = new Map<string, { username: string; name: string }>();
    const users = response?.includes?.users || result?.includes?.users || [];
    for (const user of users) {
        authors.set(user.id, { username: user.username, name: user.name });
    }

    return tweets.map((tweet: any) => {
        const author = authors.get(tweet.author_id) || { username: 'unknown', name: 'Unknown' };
        const metrics = tweet.public_metrics || {};
        const likes = metrics.like_count || 0;
        const retweets = metrics.retweet_count || 0;
        const impressions = metrics.impression_count || 0;

        // Extract linked URLs from tweet entities (articles, products the tweet references)
        const linkedUrls: string[] = [];
        if (tweet.entities?.urls) {
            for (const urlEntity of tweet.entities.urls) {
                // Use expanded_url (full URL) or unwound_url (final redirect destination)
                const realUrl = urlEntity.unwound_url || urlEntity.expanded_url || urlEntity.url || '';
                // Skip X/Twitter internal links (quote tweets, profiles)
                if (realUrl && !realUrl.includes('x.com/') && !realUrl.includes('twitter.com/')) {
                    linkedUrls.push(realUrl);
                }
            }
        }

        return {
            id: tweet.id,
            text: tweet.text,
            author_username: author.username,
            author_name: author.name,
            created_at: tweet.created_at || new Date().toISOString(),
            url: `https://x.com/${author.username}/status/${tweet.id}`,
            linked_urls: linkedUrls,
            likes,
            retweets,
            impressions,
            engagement_score: likes + retweets * 2,
            source_method: sourceMethod,
        };
    });
}

// ─── Strategy 1: Trending AI Search (PRIMARY) ─────────────────────────────────

async function searchTrendingAI(client: TwitterApi): Promise<XTweet[]> {
    console.log('[X API] Strategy 1: Trending AI keyword search...');
    try {
        const query = [
            '(AI OR "artificial intelligence" OR GPT OR Claude OR Gemini OR LLM',
            'OR "AI agent" OR "open source model" OR "AI tool")',
            '-is:retweet -is:reply lang:en has:links',
        ].join(' ');

        const result = await client.v2.search(query, {
            max_results: 100,
            sort_order: 'relevancy',
            'tweet.fields': [...TWEET_FIELDS],
            'user.fields': [...USER_FIELDS],
            expansions: [...EXPANSIONS],
        });

        const tweets = parseTweets(result, 'search');
        console.log(`[X API] Strategy 1: ${tweets.length} tweets from keyword search`);
        return tweets;
    } catch (error: any) {
        console.error('[X API] Strategy 1 failed:', error?.message || error);
        return [];
    }
}

// ─── Strategy 2: Technology Domain + Engagement (TRENDING) ─────────────────────

async function searchTechDomain(client: TwitterApi): Promise<XTweet[]> {
    console.log('[X API] Strategy 2: Technology domain context search...');
    try {
        const query = [
            'context:165.* (launched OR released OR announced OR new OR breaking)',
            '-is:retweet lang:en',
        ].join(' ');

        const result = await client.v2.search(query, {
            max_results: 50,
            sort_order: 'relevancy',
            'tweet.fields': [...TWEET_FIELDS],
            'user.fields': [...USER_FIELDS],
            expansions: [...EXPANSIONS],
        });

        const tweets = parseTweets(result, 'context_search');
        console.log(`[X API] Strategy 2: ${tweets.length} tweets from tech domain`);
        return tweets;
    } catch (error: any) {
        console.error('[X API] Strategy 2 failed:', error?.message || error);
        return [];
    }
}

// ─── Strategy 3: News Search API (CURATED) ─────────────────────────────────────

async function fetchAINewsStories(client: TwitterApi): Promise<XTweet[]> {
    console.log('[X API] Strategy 3: News Search API...');
    try {
        // /2/news/search may not be in the SDK yet — use raw fetch
        const token = decodeURIComponent(process.env.X_BEARER_TOKEN || '');
        const response = await fetch(
            'https://api.x.com/2/news/search?query=artificial+intelligence+OR+AI+OR+GPT&max_results=10',
            {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(10000),
            }
        );

        if (!response.ok) {
            // News API might not be available on all tiers
            const status = response.status;
            console.log(`[X API] Strategy 3: News API returned ${status} — may not be available on this tier`);
            return [];
        }

        const data = await response.json();

        // News API returns structured stories — convert to tweet-like format
        if (!data?.data) return [];

        return data.data.map((story: any) => ({
            id: `news_${story.id || Date.now()}`,
            text: `${story.title || ''}\n\n${story.summary || story.description || ''}`,
            author_username: 'XNews',
            author_name: 'X News (Grok-curated)',
            created_at: story.created_at || new Date().toISOString(),
            url: story.url || story.articles?.[0]?.url || '',
            linked_urls: story.articles?.map((a: any) => a.url).filter(Boolean) || [],
            likes: 0,
            retweets: 0,
            impressions: 0,
            engagement_score: 100, // News API stories get high base engagement (Grok-curated)
            source_method: 'news_api' as const,
        }));
    } catch (error: any) {
        console.error('[X API] Strategy 3 failed:', error?.message || error);
        return [];
    }
}

// ─── Strategy 4: AI Communities & Key Accounts (COMMUNITY SIGNAL) ──────────────

// Hardcoded community insiders & key AI accounts for high-signal content
// "AI — Rumors & Insights" community: x.com/i/communities/1762494276565426592
const COMMUNITY_ACCOUNTS = [
    'chetaslua',       // Mod of AI Rumors & Insights
    'Liam06972452',    // Leeham — community leaker
    'rowancheung',     // AI newsletter, community-active
    'theaaborai',      // AI insider
    'bindureddy',      // AI founder
    'svpino',          // ML engineer, hot takes
    'kaborai',         // AI community
    'DrJimFan',        // NVIDIA AI, community posts
    '_jasonwei',       // Google DeepMind researcher
    'AravSrinivas',    // Perplexity CEO
];

async function discoverAICommunities(client: TwitterApi): Promise<XTweet[]> {
    console.log('[X API] Strategy 4: Community accounts + insider search...');

    // Two sub-strategies in parallel:
    // A) Search recent posts from hardcoded community accounts
    // B) Search for insider/leak/breaking AI content from anyone
    const [accountTweets, insiderTweets] = await Promise.all([
        searchCommunityAccounts(client),
        searchInsiderContent(client),
    ]);

    const combined = [...accountTweets, ...insiderTweets];
    console.log(`[X API] Strategy 4: ${accountTweets.length} from accounts + ${insiderTweets.length} insider = ${combined.length} total`);
    return combined;
}

async function searchCommunityAccounts(client: TwitterApi): Promise<XTweet[]> {
    try {
        // Build "from:account1 OR from:account2" query
        const fromClause = COMMUNITY_ACCOUNTS.map(a => `from:${a}`).join(' OR ');
        const query = `(${fromClause}) (AI OR GPT OR LLM OR model OR agent OR Claude OR Gemini) -is:retweet lang:en`;

        const result = await client.v2.search(query, {
            max_results: 50,
            sort_order: 'recency',
            'tweet.fields': [...TWEET_FIELDS],
            'user.fields': [...USER_FIELDS],
            expansions: [...EXPANSIONS],
        });

        return parseTweets(result, 'community');
    } catch (error: any) {
        console.error('[X API] Strategy 4a (accounts) failed:', error?.message || error);
        return [];
    }
}

async function searchInsiderContent(client: TwitterApi): Promise<XTweet[]> {
    try {
        const query = [
            '(AI OR GPT OR LLM) (leak OR rumor OR insider OR "just announced"',
            'OR "breaking" OR "exclusive" OR "first look")',
            '-is:retweet -is:reply lang:en',
        ].join(' ');

        const result = await client.v2.search(query, {
            max_results: 30,
            sort_order: 'relevancy',
            'tweet.fields': [...TWEET_FIELDS],
            'user.fields': [...USER_FIELDS],
            expansions: [...EXPANSIONS],
        });

        return parseTweets(result, 'community');
    } catch (error: any) {
        console.error('[X API] Strategy 4b (insider) failed:', error?.message || error);
        return [];
    }
}

// ─── Gemini AI Layer: Filter spam + generate clean titles ────────────────────

async function processWithGemini(tweets: XTweet[]): Promise<XTweet[]> {
    if (tweets.length === 0) return [];

    console.log(`[X AI Layer] Processing ${tweets.length} tweets through Gemini...`);

    // Build a compact representation for the AI
    const tweetData = tweets.map((t, i) => ({
        idx: i,
        author: t.author_username,
        text: t.text.substring(0, 300),
        likes: t.likes,
        retweets: t.retweets,
    }));

    const prompt = `You are filtering AI/tech tweets for "Innov8 AI" newsletter. Target audience: creators, founders, builders who USE AI tools daily.

TWEETS:
${JSON.stringify(tweetData)}

For each tweet, decide:
1. Is it RELEVANT AI news? (not spam, not course promos, not generic opinions, not self-promotion)
2. If relevant, write a clean headline (max 15 words, news-style, specific)
3. If relevant, write a 1-2 sentence summary of the actual news/insight

Return JSON array with one object per tweet:
[{"idx": 0, "relevant": true, "title": "Clean headline here", "summary": "What happened and why it matters"}, ...]

FILTER OUT (relevant: false):
- "Free courses" / "paid courses free" spam
- Pure opinions with no news ("I don't read AI code", "75% of replies are AI slop")
- Self-promotion / "follow me" / "check out my..."
- Crypto/NFT spam disguised as AI
- Vague posts with no actual information
- Emoji-only or one-word posts

KEEP (relevant: true):
- Product launches, model releases, tool announcements
- Breaking news about AI companies
- Significant technical insights or benchmarks
- Notable AI community discussions with substance

Return ONLY valid JSON array.`;

    try {
        const response = await callGemini(prompt, {
            model: 'gemini-3.1-flash-lite-preview',
            temperature: 0.1,
            maxOutputTokens: 2000,
        });

        const cleanContent = response.text
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const results = JSON.parse(cleanContent);
        if (!Array.isArray(results)) throw new Error('Not an array');

        // Apply AI results to tweets
        const processed: XTweet[] = [];
        for (const result of results) {
            const tweet = tweets[result.idx];
            if (!tweet) continue;

            if (result.relevant) {
                tweet.cleaned_title = result.title || tweet.text.split('\n')[0].substring(0, 120);
                tweet.cleaned_summary = result.summary || tweet.text.substring(0, 300);
                tweet.ai_relevant = true;
                processed.push(tweet);
            }
        }

        console.log(`[X AI Layer] ${tweets.length} tweets → ${processed.length} relevant (filtered ${tweets.length - processed.length} spam/irrelevant)`);
        return processed;
    } catch (error) {
        console.error('[X AI Layer] Gemini processing failed, returning unfiltered:', error);
        // Fallback: return all tweets without AI processing
        return tweets;
    }
}

// ─── Cost-Optimized: Minimal AI Search (10 tweets only) ─────────────────────

async function searchTrendingAIMinimal(client: TwitterApi): Promise<XTweet[]> {
    console.log('[X API] Minimal search: 10 top AI tweets...');
    try {
        const query = [
            '(AI OR "artificial intelligence" OR GPT OR Claude OR Gemini OR LLM',
            'OR "AI agent" OR "open source model" OR "AI tool")',
            '-is:retweet -is:reply lang:en',
        ].join(' ');

        const result = await client.v2.search(query, {
            max_results: 10, // Minimum allowed — saves credits
            sort_order: 'relevancy',
            'tweet.fields': [...TWEET_FIELDS],
            'user.fields': [...USER_FIELDS],
            expansions: [...EXPANSIONS],
        });

        const tweets = parseTweets(result, 'search');
        console.log(`[X API] Minimal search: ${tweets.length} tweets`);
        return tweets;
    } catch (error: any) {
        console.error('[X API] Minimal search failed:', error?.message || error);
        return [];
    }
}

// ─── Orchestrator: Fetch All X Content ─────────────────────────────────────────
// COST-OPTIMIZED: Only News API + one minimal search (10 tweets)
// Previous version ran 4 strategies = 240 tweets = ~$0.89/refresh
// Now: News API (10) + minimal search (10) = ~20 tweets = ~$0.08/refresh

export async function fetchAllXContent(): Promise<XFetchResult> {
    const errors: string[] = [];
    let apiCallsMade = 0;

    try {
        const client = getClient();

        // Only run News API (cheapest) + one small keyword search as fallback
        const results = await Promise.allSettled([
            fetchAINewsStories(client),
            searchTrendingAIMinimal(client),
        ]);

        const allTweets: XTweet[] = [];

        results.forEach((result, i) => {
            apiCallsMade++;
            const strategyNames = ['News API', 'Minimal Search'];
            if (result.status === 'fulfilled') {
                allTweets.push(...result.value);
            } else {
                const msg = `${strategyNames[i]} failed: ${result.reason?.message || result.reason}`;
                errors.push(msg);
                console.error(`[X API] ${msg}`);
            }
        });

        console.log(`[X API] Total raw tweets: ${allTweets.length} from ${apiCallsMade} API calls (cost-optimized)`);

        // Dedup by tweet ID
        const seen = new Set<string>();
        const deduped = allTweets.filter(t => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
        });

        // Also dedup by similar text (first 80 chars normalized)
        const seenText = new Set<string>();
        const textDeduped = deduped.filter(t => {
            const key = t.text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
            if (seenText.has(key)) return false;
            seenText.add(key);
            return true;
        });

        // Sort by engagement score (highest first)
        textDeduped.sort((a, b) => b.engagement_score - a.engagement_score);

        // Take top 20, then run through Gemini to filter spam + clean titles
        const top = textDeduped.slice(0, 20);
        console.log(`[X API] After dedup & rank: ${textDeduped.length} unique → top ${top.length}`);

        // AI Layer: Filter irrelevant tweets + generate clean titles/summaries
        const aiProcessed = await processWithGemini(top);

        // Cache to Supabase
        await cacheToSupabase(aiProcessed);

        return {
            tweets: aiProcessed,
            cached: false,
            fetched_at: new Date().toISOString(),
            api_calls_made: apiCallsMade,
            errors,
        };
    } catch (error: any) {
        errors.push(error.message);
        console.error('[X API] Orchestrator error:', error);

        // Try returning cached data
        const cached = await getCachedXNews();
        return {
            tweets: cached,
            cached: true,
            fetched_at: new Date().toISOString(),
            api_calls_made: apiCallsMade,
            errors,
        };
    }
}

// ─── Supabase Caching ──────────────────────────────────────────────────────────

async function cacheToSupabase(tweets: XTweet[]): Promise<void> {
    if (!isSupabaseConfigured() || tweets.length === 0) return;

    try {
        // Delete old X news items
        await supabaseAdmin
            .from('news_items')
            .delete()
            .eq('source_id', X_SOURCE_ID);

        // Insert new items — ensure every row has a unique URL
        const seenUrls = new Set<string>();
        const rows = tweets
            .map(t => {
                // Guarantee unique URL: use tweet URL, or generate one from ID
                let url = t.url || `https://x.com/i/status/${t.id}`;
                if (seenUrls.has(url)) url = `${url}?d=${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                seenUrls.add(url);

                return {
                    source_id: X_SOURCE_ID,
                    url,
                    title: `@${t.author_username}: ${t.text.split('\n')[0].substring(0, 180)}`,
                    raw_summary: JSON.stringify({
                        text: t.text,
                        author_username: t.author_username,
                        author_name: t.author_name,
                        likes: t.likes,
                        retweets: t.retweets,
                        impressions: t.impressions,
                        engagement_score: t.engagement_score,
                        source_method: t.source_method,
                        linked_urls: t.linked_urls,
                        cleaned_title: t.cleaned_title,
                        cleaned_summary: t.cleaned_summary,
                    }),
                    published_at: t.created_at,
                    is_processed: false,
                };
            });

        const { error } = await supabaseAdmin
            .from('news_items')
            .upsert(rows, { onConflict: 'url', ignoreDuplicates: true });

        if (error) {
            console.error('[X API] Supabase insert error:', error);
        } else {
            console.log(`[X API] Cached ${rows.length} tweets to Supabase`);
        }
    } catch (error) {
        console.error('[X API] Cache error:', error);
    }
}

export async function getCachedXNews(): Promise<XTweet[]> {
    if (!isSupabaseConfigured()) return [];

    try {
        const { data, error } = await supabaseAdmin
            .from('news_items')
            .select('*')
            .eq('source_id', X_SOURCE_ID)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error || !data) return [];

        return data.map((item: any) => {
            // Parse rich engagement data from raw_summary JSON
            let meta: any = {};
            try {
                meta = JSON.parse(item.raw_summary || '{}');
            } catch {
                // Old format — plain text summary
                meta = { text: item.raw_summary || item.title || '' };
            }

            const handleMatch = item.title?.match(/^@(\w+):\s*/);
            const username = meta.author_username || (handleMatch ? handleMatch[1] : 'unknown');

            return {
                id: item.id?.toString() || `x_${Date.now()}`,
                text: meta.text || item.raw_summary || item.title || '',
                author_username: username,
                author_name: meta.author_name || username,
                created_at: item.published_at || item.created_at || new Date().toISOString(),
                url: item.url || '',
                linked_urls: meta.linked_urls || [],
                likes: meta.likes || 0,
                retweets: meta.retweets || 0,
                impressions: meta.impressions || 0,
                engagement_score: meta.engagement_score || 0,
                source_method: meta.source_method || 'search',
                cleaned_title: meta.cleaned_title,
                cleaned_summary: meta.cleaned_summary,
                ai_relevant: true, // cached items are already filtered
            };
        });
    } catch (error) {
        console.error('[X API] getCachedXNews error:', error);
        return [];
    }
}

export async function isCacheFresh(maxAgeMinutes: number = CACHE_TTL_MINUTES): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;

    try {
        const { data, error } = await supabaseAdmin
            .from('news_items')
            .select('created_at')
            .eq('source_id', X_SOURCE_ID)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error || !data?.length) return false;

        const lastUpdate = new Date(data[0].created_at);
        const ageMinutes = (Date.now() - lastUpdate.getTime()) / (1000 * 60);
        return ageMinutes < maxAgeMinutes;
    } catch {
        return false;
    }
}
