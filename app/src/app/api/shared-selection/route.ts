import { sameRequestOrigin } from '@/lib/site-session';
import { NextRequest, NextResponse } from 'next/server';
import { hydrateWizard, metadataOnly } from '@/lib/canonical-draft';
import type { NewsletterDraft } from '@/lib/draft-generator';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const MAX_NEWSLETTER_STORIES = 30;
const MAX_REVISION = 2_147_483_646; // PostgreSQL integer must fit the increment.
const MAX_SESSION_ID_LENGTH = 128;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

interface SharedSelectionRow {
    session_id: string;
    revision: number;
    curated_stories: unknown[];
    selected_ids: string[];
    research_reports: unknown[];
    wizard_state: JsonObject | null;
    current_draft: JsonObject | null;
    updated_at: string;
    draft_choices?: Array<{ id: string; source: string; updatedAt: string }>;
}

interface SharedSelectionPayload {
    expectedRevision: number;
    resolveVersion?: string;
    sessionId: string;
    curatedStories: unknown[];
    selectedIds: string[];
    researchReports: unknown[];
    wizardState: JsonObject | null;
    currentDraft: JsonObject | null;
}

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasStoryIdentity(value: unknown): boolean {
    return isObject(value) &&
        typeof value.id === 'string' && value.id.trim().length > 0 &&
        typeof value.headline === 'string' && value.headline.trim().length > 0;
}

function hasReportIdentity(value: unknown): boolean {
    return isObject(value) && hasStoryIdentity(value.story) &&
        typeof value.deepResearch === 'string';
}

function validatePayload(value: unknown): { payload?: SharedSelectionPayload; error?: string } {
    if (!isObject(value)) return { error: 'Expected a complete shared newsletter state.' };
    if (!Number.isSafeInteger(value.expectedRevision) ||
        (value.expectedRevision as number) < 0 || (value.expectedRevision as number) > MAX_REVISION) {
        return { error: 'expectedRevision must be a nonnegative integer.' };
    }
    if (typeof value.sessionId !== 'string' || !value.sessionId.trim() ||
        value.sessionId.length > MAX_SESSION_ID_LENGTH) {
        return { error: 'sessionId must be a nonempty string of at most 128 characters.' };
    }
    if (!Array.isArray(value.curatedStories) || !value.curatedStories.every(hasStoryIdentity)) {
        return { error: 'curatedStories must be an array of stories with IDs and headlines.' };
    }
    if (!Array.isArray(value.selectedIds) || value.selectedIds.length > MAX_NEWSLETTER_STORIES ||
        !value.selectedIds.every(id => typeof id === 'string' && id.trim().length > 0)) {
        return { error: `selectedIds must contain at most ${MAX_NEWSLETTER_STORIES} nonempty IDs.` };
    }
    if (!Array.isArray(value.researchReports) || value.researchReports.length > MAX_NEWSLETTER_STORIES ||
        !value.researchReports.every(hasReportIdentity)) {
        return { error: `researchReports must contain at most ${MAX_NEWSLETTER_STORIES} valid reports.` };
    }
    if (value.wizardState !== null && !isObject(value.wizardState)) {
        return { error: 'wizardState must be an object or null.' };
    }
    if (isObject(value.wizardState)) {
        const wizard = value.wizardState;
        if (wizard.selectedReports !== undefined &&
            (!Array.isArray(wizard.selectedReports) || wizard.selectedReports.length > MAX_NEWSLETTER_STORIES ||
                !wizard.selectedReports.every(hasReportIdentity))) {
            return { error: `wizardState.selectedReports must contain at most ${MAX_NEWSLETTER_STORIES} valid reports.` };
        }
        if (wizard.completed !== undefined && wizard.completed !== null && !isObject(wizard.completed)) {
            return { error: 'wizardState.completed must be an object.' };
        }
        if (isObject(wizard.completed) && wizard.completed.stories !== undefined &&
            (!Array.isArray(wizard.completed.stories) || wizard.completed.stories.length > MAX_NEWSLETTER_STORIES ||
                !wizard.completed.stories.every(story => story === null || isObject(story)))) {
            return { error: `wizardState.completed.stories must contain at most ${MAX_NEWSLETTER_STORIES} stories.` };
        }
    }
    if (value.currentDraft !== null && !isObject(value.currentDraft)) {
        return { error: 'currentDraft must be an object or null.' };
    }
    if (isObject(value.currentDraft) &&
        (!Array.isArray(value.currentDraft.stories) ||
            value.currentDraft.stories.length > MAX_NEWSLETTER_STORIES ||
            !value.currentDraft.stories.every(story => isObject(story) && typeof story.title === 'string'))) {
        return { error: `currentDraft.stories must contain at most ${MAX_NEWSLETTER_STORIES} titled stories.` };
    }
    if (isObject(value.currentDraft)) {
        const draft = value.currentDraft;
        if (typeof draft.studioDraftId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.studioDraftId))
            return { error: 'currentDraft requires a stable cloud draft ID.' };
        if (draft.studioServerRevision !== undefined && (!Number.isSafeInteger(draft.studioServerRevision) || (draft.studioServerRevision as number) < 0 || (draft.studioServerRevision as number) > MAX_REVISION))
            return { error: 'Invalid cloud draft revision.' };
    }
    if (value.resolveVersion !== undefined && (typeof value.resolveVersion !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.resolveVersion))) return { error: 'Invalid recovery version.' };
    return { payload: value as unknown as SharedSelectionPayload };
}

function toState(row: SharedSelectionRow) {
    if (typeof row.session_id !== 'string' || !row.session_id ||
        !Number.isSafeInteger(row.revision) || row.revision < 0 ||
        !Array.isArray(row.curated_stories) || !row.curated_stories.every(hasStoryIdentity) ||
        !Array.isArray(row.selected_ids) ||
        !row.selected_ids.every(id => typeof id === 'string' && id.trim().length > 0) ||
        !Array.isArray(row.research_reports) || !row.research_reports.every(hasReportIdentity) ||
        (row.wizard_state !== null && !isObject(row.wizard_state)) ||
        (row.current_draft !== null && !isObject(row.current_draft)) ||
        typeof row.updated_at !== 'string') {
        throw new Error('Invalid shared newsletter state in database');
    }
    return {
        sessionId: row.session_id,
        revision: row.revision,
        curatedStories: row.curated_stories,
        selectedIds: row.selected_ids,
        researchReports: row.research_reports,
        wizardState: hydrateWizard(row.wizard_state, row.current_draft as unknown as NewsletterDraft | null),
        draftChoices: row.draft_choices ?? [],
        currentDraft: row.current_draft,
        updatedAt: row.updated_at,
    };
}

async function loadRow(): Promise<SharedSelectionRow | null> {
    const { data, error } = await supabaseAdmin.rpc('newsletter_state');
    if (error) throw error;
    return data as SharedSelectionRow | null;
}

export async function GET() {
    if (!isSupabaseConfigured()) {
        return NextResponse.json({ success: false, code: 'configuration_error', error: 'Shared newsletter storage is unavailable.' }, { status: 503 });
    }
    try {
        const row = await loadRow();
        return NextResponse.json({ success: true, initialized: row !== null, state: row ? toState(row) : null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('[SharedSelection] GET failed:', error instanceof Error ? error.name : 'storage error');
        return NextResponse.json({ success: false, code: 'load_failed', error: 'Failed to load shared newsletter state.' }, { status: 503 });
    }
}

export async function PUT(request: NextRequest) {
    if (!sameRequestOrigin(request.headers.get('origin'), request.url, request.headers.get('host')))
        return NextResponse.json({ success: false, code: 'invalid_origin', error: 'Save from the newsletter app.' }, { status: 403 });
    if (!isSupabaseConfigured()) {
        return NextResponse.json({ success: false, code: 'configuration_error', error: 'Shared newsletter storage is unavailable.' }, { status: 503 });
    }
    let raw: string;
    try {
        raw = await request.text();
        if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
            return NextResponse.json({ success: false, code: 'invalid_payload', error: 'Shared newsletter state is too large.' }, { status: 413 });
        }
    } catch {
        return NextResponse.json({ success: false, code: 'invalid_payload', error: 'Could not read shared newsletter state.' }, { status: 400 });
    }
    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ success: false, code: 'invalid_payload', error: 'Expected valid JSON.' }, { status: 400 });
    }
    const { payload, error: validationError } = validatePayload(body);
    if (!payload) {
        return NextResponse.json({ success: false, code: 'invalid_payload', error: validationError }, { status: 400 });
    }

    try {
        const { data, error } = await supabaseAdmin.rpc('newsletter_save', {
            expected_revision: payload.expectedRevision,
            content: { ...payload, wizardState: metadataOnly(payload.wizardState) },
            resolve_version: payload.resolveVersion ?? null,
        });
        if (error) throw error;
        if (!data?.conflict && !data?.choiceRequired && data?.state)
            return NextResponse.json({ success: true, state: toState(data.state) }, { headers: { 'Cache-Control': 'no-store' } });
        const latest = await loadRow();
        return NextResponse.json({
            success: false,
            code: 'conflict',
            error: 'The shared newsletter changed on another device. Reload before saving.',
            state: latest ? toState(latest) : null,
        }, { status: 409 });
    } catch (error) {
        console.error('[SharedSelection] PUT failed:', error instanceof Error ? error.name : 'storage error');
        return NextResponse.json({ success: false, code: 'save_failed', error: 'Failed to save shared newsletter state.' }, { status: 503 });
    }
}
