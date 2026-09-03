import { NextRequest, NextResponse } from 'next/server';
import { buildBeehiivDraftPayload, parseNewsletterDraftInput } from '@/lib/beehiiv-export';
import { requireStudioSession, studioError } from '@/lib/studio/http';
import { StudioService } from '@/lib/studio/service';
import { SupabaseStudioRepository } from '@/lib/studio/repository';
import { StudioError, uuid } from '@/lib/studio/errors';

const BEEHIIV_API_BASE = 'https://api.beehiiv.com/v2';

function safeErrorMessage(value: unknown): string {
    if (typeof value !== 'string') return 'beehiiv request failed';
    return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 700);
}

function validatePublicationId(value: string): boolean {
    return /^pub_[0-9a-fA-F-]+$/.test(value);
}

function validateTemplateId(value: string): boolean {
    return /^post_template_[0-9a-fA-F-]+$/.test(value);
}

function parseJsonOrEmpty(value: string): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function readBeehiivPostId(value: Record<string, unknown>): string | null {
    const data = value.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const id = (data as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
}

export async function POST(request: NextRequest) {
    try {
        await requireStudioSession(request);
        const token = process.env.BEEHIIV_API_KEY;
        const publicationId = process.env.BEEHIIV_PUBLICATION_ID;
        const templateId = process.env.BEEHIIV_POST_TEMPLATE_ID;

        if (!token || !publicationId) {
            return NextResponse.json(
                { success: false, error: 'BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID must be configured on the server.' },
                { status: 500 }
            );
        }

        if (!validatePublicationId(publicationId)) {
            return NextResponse.json(
                { success: false, error: 'BEEHIIV_PUBLICATION_ID must start with pub_ and match beehiiv publication id format.' },
                { status: 500 }
            );
        }

        if (templateId && !validateTemplateId(templateId)) {
            return NextResponse.json(
                { success: false, error: 'BEEHIIV_POST_TEMPLATE_ID must start with post_template_ if configured.' },
                { status: 500 }
            );
        }

        const body = await request.json();
        const saved = body.studioDraftId ? await new StudioService(new SupabaseStudioRepository()).exportImages(uuid(body.studioDraftId)) : null;
        const draft = saved?.draft || parseNewsletterDraftInput(body?.draft);
        const imageUrls = saved?.imageUrls || (body?.imageUrls && typeof body.imageUrls === 'object' ? body.imageUrls : {});
        const { payload, skippedImages } = buildBeehiivDraftPayload(draft, imageUrls);

        const response = await fetch(`${BEEHIIV_API_BASE}/publications/${publicationId}/posts`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...payload,
                ...(templateId ? { post_template_id: templateId } : {}),
                status: 'draft',
            }),
        });

        const responseText = await response.text();
        const responseJson = parseJsonOrEmpty(responseText);

        if (!response.ok) {
            console.error('[beehiiv] Create draft failed:', response.status, safeErrorMessage(responseText));
            return NextResponse.json(
                {
                    success: false,
                    error: `beehiiv rejected the draft (${response.status}). ${safeErrorMessage(responseText)}`,
                },
                { status: response.status }
            );
        }

        return NextResponse.json({
            success: true,
            postId: readBeehiivPostId(responseJson),
            skippedImages,
        });
    } catch (error) {
        if (error instanceof StudioError) return studioError(error);
        console.error('[beehiiv] Create draft error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to create beehiiv draft.' },
            { status: 400 }
        );
    }
}
