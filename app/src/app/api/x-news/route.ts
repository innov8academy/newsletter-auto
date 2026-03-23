import { NextRequest, NextResponse } from 'next/server';
import { fetchAllXContent, getCachedXNews, isCacheFresh, XTweet } from '@/lib/x-api';

function formatTweet(t: XTweet) {
    return {
        id: t.id,
        author: t.author_username,
        author_name: t.author_name,
        // Use AI-cleaned title/summary if available, fallback to raw tweet text
        title: t.cleaned_title || t.text.split('\n')[0].substring(0, 200),
        summary: t.cleaned_summary || t.text,
        url: t.url,
        linked_urls: t.linked_urls,
        publishedAt: t.created_at,
        likes: t.likes,
        retweets: t.retweets,
        impressions: t.impressions,
        engagement_score: t.engagement_score,
        source_method: t.source_method,
    };
}

// GET = return cached X news from Supabase (fast, no API calls)
export async function GET() {
    try {
        const tweets = await getCachedXNews();
        const formatted = tweets.map(formatTweet);

        return NextResponse.json({
            items: formatted,
            count: formatted.length,
            cached: true,
        });
    } catch (error) {
        console.error('[X News API] GET error:', error);
        return NextResponse.json({ items: [], error: 'Internal error' });
    }
}

// POST = trigger fresh X API v2 fetch, then return updated items
export async function POST(request: NextRequest) {
    try {
        // Check for force refresh (bypass cache)
        let forceRefresh = false;
        try {
            const body = await request.json();
            forceRefresh = body?.force === true;
        } catch { /* no body or not JSON — that's fine */ }

        // Check if cache is still fresh (avoid unnecessary API calls)
        if (!forceRefresh) {
            const fresh = await isCacheFresh(30);
            if (fresh) {
                console.log('[X News API] Cache is fresh (<30min), returning cached data');
                return GET();
            }
        }

        console.log('[X News API] Fetching fresh data from X API v2...');
        const result = await fetchAllXContent();
        const formatted = result.tweets.map(formatTweet);

        return NextResponse.json({
            items: formatted,
            count: formatted.length,
            cached: result.cached,
            api_calls: result.api_calls_made,
            errors: result.errors.length > 0 ? result.errors : undefined,
        });
    } catch (error) {
        console.error('[X News API] POST error:', error);
        // Fallback to cached data
        return GET();
    }
}
