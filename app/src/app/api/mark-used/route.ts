// API Route: Mark stories as used
// POST /api/mark-used - Save selected story headlines to prevent duplicates

import { NextRequest, NextResponse } from 'next/server';
import { legacyDataConfigured, insertUsedStories } from '@/lib/legacy-data';

export async function POST(request: NextRequest) {
    try {
        if (!legacyDataConfigured()) {
            return NextResponse.json(
                { success: false, error: 'Storage not configured' },
                { status: 500 }
            );
        }

        const body = await request.json();
        const { stories } = body as { stories: Array<{ headline: string; url?: string }> };

        if (!stories || !Array.isArray(stories) || stories.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No stories provided' },
                { status: 400 }
            );
        }
        if (stories.length > 100 || stories.some(story => !story || typeof story.headline !== 'string' || !story.headline.trim() || story.headline.length > 1000 || (story.url !== undefined && (typeof story.url !== 'string' || story.url.length > 2000)))) {
            return NextResponse.json({ success: false, error: 'Invalid stories' }, { status: 400 });
        }

        // Insert stories into used_stories table
        const toInsert = stories.map(story => ({
            headline: story.headline,
            url: story.url || null,
            used_at: new Date().toISOString(),
        }));

        const count = await insertUsedStories(toInsert);
        console.log(`[Mark Used] Saved ${count} stories as used`);

        return NextResponse.json({
            success: true,
            count,
        });

    } catch (error) {
        console.error('[Mark Used] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
