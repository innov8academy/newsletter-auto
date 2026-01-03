// API Route: Regenerate Full Story
// POST /api/regenerate-story - Regenerate a complete story block with custom prompt

import { NextRequest, NextResponse } from 'next/server';
import { DraftModelId } from '@/lib/draft-generator';
import { calculateCost } from '@/lib/cost-tracker';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { currentStory, userPrompt, modelId, apiKey: clientApiKey, context } = body as {
            currentStory: any;
            userPrompt: string;
            modelId: DraftModelId;
            apiKey: string;
            context?: string;
        };

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';

        if (!apiKey) {
            return NextResponse.json(
                { success: false, error: 'API key is required' },
                { status: 400 }
            );
        }

        if (!currentStory || !userPrompt) {
            return NextResponse.json(
                { success: false, error: 'Current story and prompt are required' },
                { status: 400 }
            );
        }

        console.log(`[Regenerate Story] Model: ${modelId}`);

        const systemPrompt = `You are Alex — a 25-year-old AI creator and entrepreneur from Kerala, India. You write "L8R by Innov8."

## WHO YOU ARE:
- CS grad turned content creator. You USE AI daily.
- Witty, unbiased, simple English (Grade 5-6 level). No jargon.

## YOUR TASK:
Rewrite the ENTIRE story based on the user's request.
You must output a VALID JSON object matching the StoryBlock structure.

## JSON STRUCTURE:
{
  "title": "New Title",
  "hookParagraph": "New Hook",
  "bulletPoints": ["Point 1", "Point 2", "Point 3", "Point 4"],
  "whyItMatters": ["Point 1", "Point 2", "Point 3"],
  "whatsNext": ["Point 1", "Point 2", "Point 3"]
}

## WRITING RULES:
1. **Scannability is King.** Short sentences. Max 2 lines per bullet.
2. **Be Specific.** Use numbers, company names, facts.
3. **No Placeholders.** Write actual content.
4. **Unique Content.** No repetition between sections.
5. **Tone.** Conversational, "Alex" persona, slight humor, strong opinions.
6. **Emojis.** You can use emojis in the text, but NOT in the JSON keys.

${context ? `\nFOR CONTEXT, here is the original research:\n${context}\n` : ''}`;

        const userMessage = `Current Story Content:
"""
Title: ${currentStory.title}
Hook: ${currentStory.hookParagraph}
Key Points: ${currentStory.bulletPoints.join('\n')}
Why It Matters: ${currentStory.whyItMatters.join('\n')}
What's Next: ${currentStory.whatsNext.join('\n')}
"""

User Request: ${userPrompt}

Rewrite the full story as a JSON object. Return ONLY the valid JSON, no markdown formatting or backticks.`;

        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': 'Innov8 AI Story Regenerator',
            },
            body: JSON.stringify({
                model: modelId,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                temperature: 0.7,
                max_tokens: 4000,
                response_format: { type: "json_object" } // Force JSON output
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { success: false, error: `API Error: ${response.status} - ${errorText}` },
                { status: 500 }
            );
        }

        const data = await response.json();
        let content = data.choices?.[0]?.message?.content;

        if (!content) {
            return NextResponse.json(
                { success: false, error: 'No content in API response' },
                { status: 500 }
            );
        }

        try {
            // Parse JSON response
            const newStory = JSON.parse(content);

            // Validate structure (basic check)
            if (!newStory.title || !newStory.hookParagraph || !Array.isArray(newStory.bulletPoints)) {
                throw new Error('Invalid JSON structure returned from AI');
            }

            // Ensure arrays are limited to correct length
            newStory.bulletPoints = newStory.bulletPoints.slice(0, 4);
            newStory.whyItMatters = newStory.whyItMatters.slice(0, 3);
            newStory.whatsNext = newStory.whatsNext.slice(0, 3);

            // Estimate cost: ~2000 input tokens, ~2000 output tokens
            const cost = calculateCost(modelId, 2000, 2000);

            return NextResponse.json({
                success: true,
                story: newStory,
                cost,
                costSource: 'regen-story',
                model: modelId,
            });
        } catch (e) {
            console.error('JSON Parse Error:', e);
            console.error('Raw Content:', content);
            return NextResponse.json(
                { success: false, error: 'Failed to parse AI response as JSON' },
                { status: 500 }
            );
        }

    } catch (error) {
        console.error('[Regenerate Story] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
