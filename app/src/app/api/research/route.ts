// API Route: Deep Research Agent
// POST /api/research - Generate comprehensive research report for a story

import { NextRequest, NextResponse } from 'next/server';
import { generateResearchReport, ResearchModelId } from '@/lib/researcher';
import { CuratedStory } from '@/lib/types';
import { calculateCost } from '@/lib/cost-tracker';

// Extended timeout for deep research models (can take 2-5 minutes)
// OpenAI deep research models perform web searches and need more time
export const maxDuration = 300; // 5 minutes for deep research

export async function POST(request: NextRequest) {
    console.log('[Research API] POST request received');

    try {
        const body = await request.json();
        console.log('[Research API] Request body parsed:', {
            hasStory: !!body.story,
            storyHeadline: body.story?.headline?.substring(0, 50),
            hasApiKey: !!body.apiKey,
            modelId: body.modelId
        });

        const { story, apiKey: clientApiKey, modelId } = body as {
            story: CuratedStory;
            apiKey: string;
            modelId?: ResearchModelId;
        };

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';
        const selectedModel = modelId || 'perplexity/sonar';

        console.log('[Research API] Using model:', selectedModel);
        console.log('[Research API] API key present:', !!apiKey, 'length:', apiKey?.length);

        if (!story) {
            return NextResponse.json(
                { success: false, error: 'Story is required' },
                { status: 400 }
            );
        }

        if (!apiKey) {
            return NextResponse.json(
                { success: false, error: 'API key is required' },
                { status: 400 }
            );
        }

        console.log(`[Research] Starting deep dive on: ${story.headline} (model: ${selectedModel})`);
        const startTime = Date.now();

        console.log('[Research API] Calling generateResearchReport...');
        const result = await generateResearchReport(story, apiKey, modelId);
        console.log('[Research API] generateResearchReport returned:', { success: result.success, hasReport: !!result.report, error: result.error });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Research] Completed in ${duration}s - Success: ${result.success}`);

        // Estimate cost: ~1500 input tokens (prompt + story) and ~2000 output tokens (research report)
        const estimatedInputTokens = 1500;
        const estimatedOutputTokens = 2000;
        const cost = calculateCost(selectedModel, estimatedInputTokens, estimatedOutputTokens);

        if (result.success) {
            return NextResponse.json({
                success: true,
                report: result.report,
                duration: parseFloat(duration),
                cost,
                costSource: 'research',
                model: selectedModel,
            });
        } else {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 500 }
            );
        }

    } catch (error) {
        console.error('[Research] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
