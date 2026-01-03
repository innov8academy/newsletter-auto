// API Route: Newsletter Draft Generator
// POST /api/generate-draft - Generate newsletter from research reports

import { NextRequest, NextResponse } from 'next/server';
import { generateNewsletterDraft, DraftModelId } from '@/lib/draft-generator';
import { ResearchReport } from '@/lib/types';
import { calculateCost } from '@/lib/cost-tracker';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { reports, apiKey: clientApiKey, modelId } = body as {
            reports: ResearchReport[];
            apiKey: string;
            modelId?: DraftModelId;
        };

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';
        const selectedModel = modelId || 'anthropic/claude-sonnet-4';

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

        // Generate full newsletter draft
        console.log(`[Draft] Generating newsletter from ${reports.length} reports (model: ${selectedModel})`);
        const startTime = Date.now();

        const result = await generateNewsletterDraft(reports, apiKey, modelId);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Draft] Completed in ${duration}s - Success: ${result.success}`);

        // Estimate cost: ~3000 input tokens per report + 500 base, ~4000 output tokens
        const estimatedInputTokens = 500 + (reports.length * 3000);
        const estimatedOutputTokens = 4000;
        const cost = calculateCost(selectedModel, estimatedInputTokens, estimatedOutputTokens);

        if (result.success) {
            return NextResponse.json({
                success: true,
                draft: result.draft,
                duration: parseFloat(duration),
                cost,
                costSource: 'draft',
                model: selectedModel,
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
