import { NextResponse } from 'next/server';
import { curateNews } from '@/lib/smart-curator';
import { calculateCost } from '@/lib/cost-tracker';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const apiKey = body.apiKey || process.env.OPENROUTER_API_KEY || '';
        const customFeeds = body.customFeeds || [];

        if (!apiKey) {
            return NextResponse.json(
                { success: false, error: 'API key required' },
                { status: 400 }
            );
        }

        // Run the smart curation
        const result = await curateNews(apiKey, undefined, customFeeds);

        // Estimate cost: ~2000 input tokens and ~500 output tokens per article processed
        // The curation processes up to 20 articles
        const articlesProcessed = result.stats?.articlesProcessed || 20;
        const estimatedInputTokens = articlesProcessed * 2000;
        const estimatedOutputTokens = articlesProcessed * 500;
        const cost = calculateCost('google/gemini-2.0-flash-001', estimatedInputTokens, estimatedOutputTokens);

        return NextResponse.json({
            success: true,
            count: result.stories.length,
            stories: result.stories,
            stats: result.stats,
            cost,
            costSource: 'curate',
            model: 'google/gemini-2.0-flash-001',
        });
    } catch (error) {
        console.error('Curation error:', error);
        return NextResponse.json(
            { success: false, error: 'Curation failed' },
            { status: 500 }
        );
    }
}
