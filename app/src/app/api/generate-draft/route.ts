// API Route: Newsletter Draft Generator
// POST /api/generate-draft - Generate newsletter from research reports

import { NextRequest, NextResponse } from 'next/server';
import { generateNewsletterDraft, DraftModelId, DEFAULT_DRAFT_MODEL, DEFAULT_INTRO_MODEL } from '@/lib/draft-generator';
import { ResearchReport } from '@/lib/types';
import { calculateCost } from '@/lib/cost-tracker';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { reports, apiKey: clientApiKey, modelId, introModelId } = body as {
            reports: ResearchReport[];
            apiKey: string;
            modelId?: DraftModelId;
            introModelId?: DraftModelId;
        };

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';
        const storyModel = modelId || DEFAULT_DRAFT_MODEL;
        const introModel = introModelId || DEFAULT_INTRO_MODEL;

        // Get current date for accurate temporal references
        const currentDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        if (!reports || reports.length === 0) {
            return NextResponse.json(
                { success: false, error: 'At least one research report is required' },
                { status: 400 }
            );
        }

        if (!apiKey) {
            return NextResponse.json(
                { success: false, error: 'API key is required' },
                { status: 400 }
            );
        }

        // Generate full newsletter draft (two-phase: intro with Claude Sonnet, stories with Gemini 3 Pro)
        console.log(`[Draft] Generating newsletter from ${reports.length} reports`);
        console.log(`[Draft] Intro model: ${introModel}, Story model: ${storyModel}`);
        console.log(`[Draft] Current date context: ${currentDate}`);
        const startTime = Date.now();

        const result = await generateNewsletterDraft(reports, apiKey, modelId, introModelId, currentDate);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Draft] Completed in ${duration}s - Success: ${result.success}`);

        // Estimate cost for TWO API calls
        // Phase 1 (intro): ~2000 input tokens, ~1500 output tokens
        // Phase 2 (stories): ~3000 input tokens per report, ~4000 output tokens
        const introInputTokens = 2000 + (reports.length * 1000);
        const introOutputTokens = 1500;
        const storiesInputTokens = 500 + (reports.length * 3000);
        const storiesOutputTokens = 4000;

        const introCost = calculateCost(introModel, introInputTokens, introOutputTokens);
        const storiesCost = calculateCost(storyModel, storiesInputTokens, storiesOutputTokens);
        const totalCost = introCost + storiesCost;

        if (result.success) {
            // Log RAG status for confirmation
            if (result.ragInfo?.used) {
                console.log(`[Draft] ✅ RAG used! ${result.ragInfo.newslettersFound} past newsletters included: ${result.ragInfo.newsletterNames.join(', ')}`);
            } else {
                console.log('[Draft] ⚠️ RAG not used - no past newsletters found');
            }

            return NextResponse.json({
                success: true,
                draft: result.draft,
                duration: parseFloat(duration),
                cost: totalCost,
                costSource: 'draft',
                model: storyModel,
                modelsUsed: result.modelsUsed || { intro: introModel, stories: storyModel },
                ragInfo: result.ragInfo,
            });
        } else {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 500 }
            );
        }

    } catch (error) {
        console.error('[Draft] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
