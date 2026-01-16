import { NextRequest, NextResponse } from 'next/server';
import { calculateCost } from '@/lib/cost-tracker';

export async function POST(request: NextRequest) {
    console.log('API: generate-image-prompt called');
    try {
        const {
            sectionText,
            styleContext,
            newsletterContext,
            userIdeas,
            referenceImages,
            apiKey: clientApiKey
        } = await request.json();

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';

        console.log('API: params received', {
            sectionLength: sectionText?.length,
            hasUserIdeas: !!userIdeas,
            referenceImageCount: referenceImages?.length || 0
        });

        if (!sectionText || !apiKey) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Build the system prompt
        const systemPrompt = `You are an expert AI Art Director for a cutting-edge tech newsletter called "L8R by Innov8".
Your goal is to create a detailed, vivid, and stylistic image generation prompt based on a specific news section.

**The Aesthetic (L8R Style):**
- **Vibrant & Tech-Forward:** Use neon accents, glassmorphism, or clean futuristic lines.
- **Conceptual:** Specific objects from the news story should be central.
- **Lighting:** Cinematic, dramatic, or studio lighting.
- **Aspect Ratio:** 16:9 (Landscape).
- **Avoid:** Generic "AI brain" stock photos, messy text, cluttered compositions.

**Instructions:**
1. Read the provided news text carefully.
2. Extract the core subject (e.g., a specific robot, a CEO, a chip, a software interface).
3. If the user has provided reference images, analyze them and INCORPORATE the key visual elements (characters, poses, expressions, objects) into your prompt naturally.
4. If the user has provided creative ideas, use them to guide how reference elements should be merged with the news story.
5. Visualize a scene that represents the story and any user-specified creative direction.
6. Write a prompt optimized for high-end diffusion models (Flux, Midjourney, DALL-E 3).
7. Include technical keywords (e.g., "8k resolution", "unreal engine 5", "octane render", "volumetric lighting").

Output ONLY the prompt text, nothing else.`;

        // Build the user message - potentially multimodal if reference images exist
        const hasReferenceImages = referenceImages && referenceImages.length > 0;

        let userMessageContent: unknown;

        if (hasReferenceImages) {
            // Build multimodal content with images first, then text
            const contentParts: unknown[] = [];

            // Add reference images
            for (const img of referenceImages) {
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${img.mimeType};base64,${img.base64}`
                    }
                });
            }

            // Add text prompt
            let textPrompt = `Generate an image prompt for this news story:\n\n"${sectionText}"`;

            if (userIdeas && userIdeas.trim()) {
                textPrompt += `\n\n**User's Creative Direction:**\n${userIdeas}`;
            }

            textPrompt += `\n\n${styleContext ? `Additional Style Notes: ${styleContext}` : ''}`;
            textPrompt += `\n${newsletterContext ? `Newsletter Context: ${newsletterContext}` : ''}`;
            textPrompt += `\n\n**IMPORTANT:** Analyze the reference images above and incorporate their key visual elements (characters, poses, expressions, style) into the generated prompt as described in the user's creative direction.`;

            contentParts.push({
                type: 'text',
                text: textPrompt
            });

            userMessageContent = contentParts;
        } else {
            // Simple text-only message
            let textPrompt = `Generate an image prompt for this news story:\n\n"${sectionText}"`;

            if (userIdeas && userIdeas.trim()) {
                textPrompt += `\n\n**User's Creative Direction:**\n${userIdeas}`;
            }

            textPrompt += `\n\n${styleContext ? `Additional Style Notes: ${styleContext}` : ''}`;
            textPrompt += `\n${newsletterContext ? `Newsletter Context: ${newsletterContext}` : ''}`;

            userMessageContent = textPrompt;
        }

        // Use vision-capable model if we have images
        const model = hasReferenceImages
            ? 'google/gemini-2.0-flash-001' // Vision capable
            : 'google/gemini-2.0-flash-001';

        console.log('API: Sending to model', model, 'with', hasReferenceImages ? 'multimodal' : 'text-only', 'content');

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8-newsletter.local',
                'X-Title': 'Innov8 Image Prompter',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessageContent }
                ],
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const generatedPrompt = data.choices?.[0]?.message?.content?.trim();

        // Estimate cost: more tokens for multimodal
        const inputTokens = hasReferenceImages ? 2000 : 500;
        const cost = calculateCost(model, inputTokens, 200);

        return NextResponse.json({
            success: true,
            prompt: generatedPrompt,
            cost,
            costSource: 'image-prompt',
            model,
            analyzedImages: hasReferenceImages ? referenceImages.length : 0,
        });

    } catch (error) {
        console.error('Image Prompt Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
