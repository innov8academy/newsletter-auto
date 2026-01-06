import { NextRequest, NextResponse } from 'next/server';
import { generateStandaloneMemeIdeas } from '@/lib/draft-generator';
import { getApiKey } from '@/lib/storage'; // Note: storage is client-side, we need to handle key differently

export async function POST(req: NextRequest) {
    try {
        const { storyHeadline, storySummary, modelId, apiKey } = await req.json();

        if (!storyHeadline || !apiKey) {
            return NextResponse.json(
                { success: false, error: 'Missing headline or API key' },
                { status: 400 }
            );
        }

        const result = await generateStandaloneMemeIdeas(storyHeadline, storySummary, apiKey, modelId);

        return NextResponse.json(result);

    } catch (error) {
        console.error('Meme API error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
