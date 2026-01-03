import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
    try {
        const { topic, apiKey } = await req.json();

        if (!topic) {
            return NextResponse.json({ success: false, error: 'Topic is required' }, { status: 400 });
        }

        if (!apiKey) {
            return NextResponse.json({ success: false, error: 'API key is required' }, { status: 401 });
        }

        const systemPrompt = `You are an expert research strategist. Your goal is to convert a user's rough search topic into a comprehensive research directive for an AI researcher agent.

INPUT: A simple or vague topic (e.g., "Apple AI", "New robotic dogs").
OUTPUT: A detailed, multi-faceted research prompt that covers:
1. Latest news and developments (last 30 days)
2. Technical details and specs
3. Market impact and competitor analysis
4. Public sentiment and expert opinions

The output must be a single coherent paragraph starting with "Research the latest developments in..."`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://newsletter-auto.com',
                'X-Title': 'Newsletter Auto',
            },
            body: JSON.stringify({
                model: 'google/gemini-flash-1.5', // Fast, efficient model
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Enhance this research topic: "${topic}"` }
                ],
                temperature: 0.3,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenRouter API error: ${error}`);
        }

        const data = await response.json();
        const enhancedPrompt = data.choices[0]?.message?.content || topic;

        return NextResponse.json({ success: true, enhancedPrompt });
    } catch (error) {
        console.error('Prompt enhancement failed:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
