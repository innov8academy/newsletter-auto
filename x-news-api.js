#!/usr/bin/env node
// Tiny API that runs bird CLI on-demand and returns fresh X/Twitter AI news
// Exposed via Tailscale funnel

const http = require('http');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const BIRD = '/home/ubuntu/.local/bin/bird';
const CACHE_FILE = '/home/ubuntu/clawd/projects/newsletter-auto/x-news-cache/latest.json';
const GIST_ID = '58bd9d2317950e97c41d561081546c05';

// Simple API key to prevent abuse
const API_KEY = process.env.X_NEWS_API_KEY || 'innov8-x-news-2026';

let isFetching = false;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function runBird(cmd) {
    try {
        const result = execSync(`${BIRD} ${cmd}`, {
            timeout: 30000,
            encoding: 'utf-8',
            env: { ...process.env, NO_COLOR: '1' }
        });
        return JSON.parse(result);
    } catch (e) {
        log(`bird error for "${cmd}": ${e.message}`);
        return [];
    }
}

function extractTweet(tweet, sourceType) {
    if (!tweet || typeof tweet !== 'object') return null;

    const text = tweet.text || tweet.full_text || tweet.content || '';
    if (!text || text.startsWith('RT @')) return null;

    let author = tweet.author || tweet.user?.screen_name || tweet.username || '';
    if (typeof author === 'object') author = author.screen_name || author.username || '';

    const tweetId = String(tweet.id || tweet.id_str || '');
    const likes = Number(tweet.favorite_count || tweet.likes || tweet.favoriteCount || 0);
    const retweets = Number(tweet.retweet_count || tweet.retweets || tweet.retweetCount || 0);

    const crypto = require('crypto');
    const id = crypto.createHash('md5').update(`${text.slice(0, 100)}-${author}`).digest('hex').slice(0, 12);

    return {
        id,
        tweet_id: tweetId,
        text: text.slice(0, 500),
        author,
        url: author && tweetId ? `https://x.com/${author}/status/${tweetId}` : tweet.url || '',
        likes,
        retweets,
        engagement: likes + retweets * 2,
        created_at: tweet.created_at || tweet.createdAt || '',
        source_type: sourceType,
        fetched_at: new Date().toISOString()
    };
}

function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        return data.items || data.tweets || data.results || [data];
    }
    return [];
}

const FETCHER_SCRIPT = '/home/ubuntu/clawd/projects/newsletter-auto/x-news-fetcher.sh';

async function fetchFreshXNews() {
    if (isFetching) {
        log('Already fetching, returning cached...');
        return getCached();
    }

    isFetching = true;
    log('Running full fetcher script (Alex cookies + Supabase push)...');

    try {
        // Run the full fetcher script which uses Alex's cookies and pushes to Supabase
        execSync(`bash ${FETCHER_SCRIPT}`, { timeout: 120000, encoding: 'utf-8' });
        log('Fetcher script completed');
        return getCached();
    } catch (e) {
        log(`Fetcher script error: ${e.message}`);
        return getCached();
    } finally {
        isFetching = false;
    }
}

async function fetchFreshXNews_OLD() {
    // OLD: kept for reference
    let _unused = true;
    const allItems = [];

    try {
        // Layer 1: AI trending news
        log('Layer 1: Trending AI news...');
        const trending = runBird('news --ai-only -n 20 --json');
        normalizeItems(trending).forEach(t => {
            const item = extractTweet(t, 'trending');
            if (item) allItems.push(item);
        });

        // Layer 2: High-engagement AI searches
        log('Layer 2: Targeted searches...');
        const searches = [
            '"AI" min_faves:500 -is:retweet',
            'GPT OR Claude OR Gemini announcement min_faves:300 -is:retweet',
            'OpenAI OR Anthropic OR "Google AI" min_faves:500 -is:retweet',
        ];

        for (const query of searches) {
            const results = runBird(`search "${query}" -n 10 --json`);
            normalizeItems(results).forEach(t => {
                const item = extractTweet(t, 'search');
                if (item) allItems.push(item);
            });
        }

        // Deduplicate
        const seen = new Set();
        const unique = allItems.filter(item => {
            const key = item.text.slice(0, 80).toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Sort by engagement
        unique.sort((a, b) => b.engagement - a.engagement);

        const output = {
            fetched_at: new Date().toISOString(),
            count: unique.length,
            items: unique.slice(0, 50)
        };

        // Save to cache
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(output, null, 2));

        // Update gist in background (don't block response)
        exec(`gh gist edit ${GIST_ID} ${CACHE_FILE}`, (err) => {
            if (err) log(`Gist update failed: ${err.message}`);
            else log('Gist updated.');
        });

        log(`Done: ${unique.length} unique items`);
        return output;
    } catch (e) {
        log(`Fetch error: ${e.message}`);
        return getCached();
    } finally {
        isFetching = false;
    }
}

function getCached() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } catch {
        return { fetched_at: null, count: 0, items: [] };
    }
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Check API key
    const key = url.searchParams.get('key') || req.headers['x-api-key'];
    if (key !== API_KEY) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Invalid API key' }));
    }

    if (url.pathname === '/x-news' || url.pathname === '/') {
        const fresh = url.searchParams.get('fresh') === 'true';

        if (fresh) {
            const data = await fetchFreshXNews();
            res.writeHead(200);
            return res.end(JSON.stringify(data));
        } else {
            const data = getCached();
            res.writeHead(200);
            return res.end(JSON.stringify(data));
        }
    }

    if (url.pathname === '/health') {
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'ok', cached: fs.existsSync(CACHE_FILE) }));
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
    log(`X News API listening on http://127.0.0.1:${PORT}`);
    log(`Tailscale funnel: https://ip-172-31-46-67.tail060601.ts.net/x-news?key=${API_KEY}&fresh=true`);
});
