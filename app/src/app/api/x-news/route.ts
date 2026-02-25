import { NextResponse } from 'next/server';

const X_SOURCE_ID = 'd5ec53f3-063c-4efa-a6b7-f6dd0781aff8';

// POST = trigger fresh fetch from EC2 bird API, then return updated items
export async function POST() {
    try {
        // Trigger fresh bird fetch via the EC2 API
        const apiUrl = process.env.X_NEWS_API_URL || 'https://ip-172-31-46-67.tail060601.ts.net';
        const apiKey = process.env.X_NEWS_API_KEY || 'innov8-x-news-2026';
        
        try {
            await fetch(`${apiUrl}/x-news?key=${apiKey}&fresh=true`, {
                signal: AbortSignal.timeout(60000),
            });
        } catch (e) {
            console.log('[X News] Fresh fetch from EC2 failed, using cached data');
        }

        // Now return the updated Supabase data (bird pushes to Supabase)
        return GET();
    } catch (error) {
        return GET(); // Fallback to cached
    }
}

export async function GET() {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json({ items: [], error: 'Supabase not configured' });
        }

        const response = await fetch(
            `${supabaseUrl}/rest/v1/news_items?source_id=eq.${X_SOURCE_ID}&order=created_at.desc&limit=15`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                },
                cache: 'no-store',
            }
        );

        if (!response.ok) {
            return NextResponse.json({ items: [], error: 'Failed to fetch' });
        }

        const items = await response.json();

        const formatted = items.map((item: any) => {
            const handleMatch = item.title?.match(/^@(\w+):\s*/);
            const author = handleMatch ? handleMatch[1] : 'unknown';
            const cleanTitle = item.title?.replace(/^@\w+:\s*/, '') || '';

            return {
                id: item.id,
                author,
                title: cleanTitle,
                summary: item.raw_summary || cleanTitle,
                url: item.url || '',
                publishedAt: item.published_at || item.created_at,
            };
        });

        return NextResponse.json({ items: formatted, count: formatted.length });
    } catch (error) {
        console.error('X news API error:', error);
        return NextResponse.json({ items: [], error: 'Internal error' });
    }
}
