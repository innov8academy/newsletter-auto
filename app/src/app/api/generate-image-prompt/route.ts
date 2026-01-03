
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    console.log('API: generate-image-prompt called');
    try {
        const { sectionText, styleContext, newsletterContext, apiKey } = await request.json();
        console.log('API: params received', { sectionLength: sectionText?.length });

        if (!sectionText || !apiKey) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const systemPrompt = `You are an expert AI Art Director for a cutting-edge tech newsletter called "L8R by Innov8".
Your goal is to create a detailed, vivid, and stylistic image generation prompt based on a specific news section.

**The Aesthetic (L8R Style):**
- **Vibrant & Tech-Forward:** Use neon accents, glassmorphism, or clean futuristic lines.
- **Conceptual:** specific objects from the news story should be central.
- **Lighting:** Cinematic, dramatic, or studio lighting.
- **Aspect Ratio:** 16:9 (Landscape).
- **Avoid:** Generic "AI brain" stock photos, messy text, cluttered compositions.

**Instructions:**
1.  Read the provided news text carefully.
2.  Extract the core subject (e.g., a specific robot, a CEO, a chip, a software interface).
3.  Visualize a scene that represents the "Hot Take" or the implications of the story.
4.  Write a prompt optimized for high-end diffusion models (Flux, Midjourney, DALL-E 3).
5.  Include technical keywords (e.g., "8k resolution", "unreal engine 5", "octane render", "volumetric lighting").

Output ONLY the prompt text, nothing else.`;

        const userPrompt = `Generate an image prompt for this news story:

"${sectionText}"

${styleContext ? `Additional Style Notes: ${styleContext}` : ''}
${newsletterContext ? `Newsletter Context: ${newsletterContext}` : ''}
`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8-newsletter.local',
                'X-Title': 'Innov8 Image Prompter',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001', // Fast, smart model for prompt engineering
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const data = await response.json();
        const generatedPrompt = data.choices?.[0]?.message?.content?.trim();

        return NextResponse.json({ success: true, prompt: generatedPrompt });

    } catch (error) {
        console.error('Image Prompt Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
