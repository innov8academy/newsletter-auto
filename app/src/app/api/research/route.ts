// API Route: Deep Research Agent
// POST /api/research - Generate comprehensive research report for a story

import { NextRequest, NextResponse } from 'next/server';
import { generateResearchReport, ResearchModelId } from '@/lib/researcher';
import { CuratedStory } from '@/lib/types';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { story, apiKey, modelId } = body as {
            story: CuratedStory;
            apiKey: string;
            modelId?: ResearchModelId;
        };

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

        console.log(`[Research] Starting deep dive on: ${story.headline} (model: ${modelId || 'default'})`);
        const startTime = Date.now();

        const result = await generateResearchReport(story, apiKey, modelId);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Research] Completed in ${duration}s - Success: ${result.success}`);

        if (result.success) {
            return NextResponse.json({
                success: true,
                report: result.report,
                duration: parseFloat(duration),
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
