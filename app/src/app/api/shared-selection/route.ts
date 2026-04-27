import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { CuratedStory } from '@/lib/types';

const SHARED_SELECTION_ID = 'default';

interface SharedSelectionPayload {
    curatedStories?: CuratedStory[];
    selectedIds?: string[];
}

function normalizePayload(payload: SharedSelectionPayload) {
    return {
        curatedStories: Array.isArray(payload.curatedStories) ? payload.curatedStories : [],
        selectedIds: Array.isArray(payload.selectedIds) ? payload.selectedIds : [],
    };
}

export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('shared_news_selection')
            .select('curated_stories, selected_ids, updated_at')
            .eq('id', SHARED_SELECTION_ID)
            .maybeSingle();

        if (error) {
            console.error('[SharedSelection] GET error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            state: {
                curatedStories: data?.curated_stories ?? [],
                selectedIds: data?.selected_ids ?? [],
                updatedAt: data?.updated_at ?? null,
            },
        });
    } catch (error) {
        console.error('[SharedSelection] GET failed:', error);
        return NextResponse.json({ success: false, error: 'Failed to load shared selection' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const payload = normalizePayload(await request.json());

        const { error } = await supabaseAdmin
            .from('shared_news_selection')
            .upsert({
                id: SHARED_SELECTION_ID,
                curated_stories: payload.curatedStories,
                selected_ids: payload.selectedIds,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });

        if (error) {
            console.error('[SharedSelection] PUT error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[SharedSelection] PUT failed:', error);
        return NextResponse.json({ success: false, error: 'Failed to save shared selection' }, { status: 500 });
    }
}
