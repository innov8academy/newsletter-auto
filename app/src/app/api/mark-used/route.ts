// API Route: Mark stories as used
// POST /api/mark-used - Save selected story headlines to prevent duplicates

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        if (!isSupabaseConfigured()) {
            return NextResponse.json(
                { success: false, error: 'Supabase not configured' },
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

        // Insert stories into used_stories table
        const toInsert = stories.map(story => ({
            headline: story.headline,
            url: story.url || null,
            used_at: new Date().toISOString(),
        }));

        const { data, error } = await supabaseAdmin
            .from('used_stories')
            .insert(toInsert)
            .select();

        if (error) {
            console.error('[Mark Used] Supabase error:', error);
            return NextResponse.json(
                { success: false, error: 'Failed to save used stories' },
                { status: 500 }
            );
        }

        console.log(`[Mark Used] Saved ${data?.length || 0} stories as used`);

        return NextResponse.json({
            success: true,
            count: data?.length || 0,
        });

    } catch (error) {
        console.error('[Mark Used] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
