import { NextRequest, NextResponse } from 'next/server';
import { calculateCost } from '@/lib/cost-tracker';
import { searchRelevantImages, buildImageContext, fetchImageAsBase64 } from '@/lib/image-search';

export async function POST(request: NextRequest) {
    console.log('API: generate-image-prompt called');
    try {
        const {
            sectionText,
            styleContext,
            newsletterContext,
            userIdeas,
            referenceImages,
            apiKey: clientApiKey,
            searchForReferences = true, // Enable web search for reference images
            storyTitle, // Headline for image search
            webReferenceContext, // Pre-searched web references from UI
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

        // Web reference context - either from UI or auto-search
        let webSearchContext = '';
        let searchedImages: { url: string; title: string; source: string }[] = [];
        
        // If UI provided web references, use those
        if (webReferenceContext && webReferenceContext.trim()) {
            webSearchContext = `
**REAL-WORLD VISUAL REFERENCES (selected by user):**
${webReferenceContext}

Use these as inspiration for visual elements, composition, and style. The image should feel connected to actual news coverage, not generic stock art.`;
            console.log('[ImagePrompt] Using UI-provided web references');
        }
        // Otherwise, auto-search if enabled and no manual refs
        else if (searchForReferences && (!referenceImages || referenceImages.length === 0)) {
            const headline = storyTitle || sectionText.split('\n')[0].substring(0, 100);
            
            console.log('[ImagePrompt] Searching web for reference images...');
            searchedImages = await searchRelevantImages(headline, 3);
            
            if (searchedImages.length > 0) {
                webSearchContext = buildImageContext(searchedImages);
                console.log(`[ImagePrompt] Found ${searchedImages.length} reference images from web`);
            }
        }

        // Build the system prompt - PRIORITIZE MEME when reference images are provided
        const hasReferenceImages = referenceImages && referenceImages.length > 0;

        const systemPrompt = hasReferenceImages
            ? `You are an expert AI Art Director specializing in MEME-FIRST image compositions.

**CRITICAL INSTRUCTION: THE MEME/REFERENCE IMAGE IS THE STAR**
When reference images are provided, they are the CENTRAL FOCUS of the image. The news story provides CONTEXT, but the meme character/element must be the HERO of the composition.

**Your Approach:**
1. ANALYZE the reference image(s) carefully - identify the character, their pose, expression, style, and what makes them iconic.
2. PRESERVE the meme's essence - the character should be instantly recognizable.
3. BUILD the scene AROUND the meme - use the news story to create a relevant backdrop or context.
4. The meme character should be REACTING TO or INTERACTING WITH elements from the news.

**Composition Guidelines:**
- Meme character: 60-70% of visual focus
- News context/elements: 30-40% as supporting backdrop
- Keep the meme's original style/aesthetic prominent
- Dramatic, cinematic lighting on the meme character
- 16:9 aspect ratio

**Example Approach:**
If the meme shows a shocked person and the news is about Bitcoin hitting $100K:
→ Place the meme character in the CENTER looking shocked
→ Add Bitcoin symbols, price charts, gold coins AROUND them as context
→ The meme character is REACTING to the Bitcoin news

Output ONLY the final image generation prompt, nothing else.`
            : `You are an expert AI Art Director for a cutting-edge tech newsletter called "L8R by Innov8".
Your goal is to create a detailed, vivid, and UNIQUE image generation prompt based on a specific news section.

**The Aesthetic (L8R Style):**
- **Vibrant & Tech-Forward:** Use neon accents, glassmorphism, or clean futuristic lines.
- **Conceptual:** Specific objects from the news story should be central - NOT generic AI imagery.
- **Lighting:** Cinematic, dramatic, or studio lighting.
- **Aspect Ratio:** 16:9 (Landscape).
- **CRITICAL - Avoid:** Generic "AI brain" stock photos, floating hologram hands, abstract neural networks, glowing orbs. These are BANNED.

**Instructions:**
1. Read the provided news text carefully.
2. Extract the SPECIFIC subject (e.g., "Sam Altman", "Nvidia H100 chip", "ByteDance logo", "TikTok interface").
3. If web reference images are provided, use them as VISUAL INSPIRATION for composition and style.
4. Create a UNIQUE scene - each story should look different.
5. Include specific visual elements: company logos, product shots, recognizable people/objects.
6. Write a prompt optimized for high-end diffusion models (Flux, Midjourney, DALL-E 3).
7. Include technical keywords (e.g., "8k resolution", "unreal engine 5", "octane render", "volumetric lighting").

**Variety Tips:**
- Story about a company? → Feature their logo/product prominently
- Story about a person? → Describe their appearance or a symbolic representation
- Story about a trend? → Create a metaphorical scene with specific objects
- Story about data/numbers? → Use infographic-style elements with the actual figures

Output ONLY the prompt text, nothing else.`;

        // Build the user message - potentially multimodal if reference images exist

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

            // Add text prompt - MEME FIRST approach
            let textPrompt = `**REFERENCE IMAGE(S) ABOVE ARE THE STAR OF THIS IMAGE**

The meme/character in the reference image(s) should be the CENTRAL FOCUS (60-70% of composition).

NEWS CONTEXT to build around the meme:
"${sectionText}"`;

            if (userIdeas && userIdeas.trim()) {
                textPrompt += `

**User's Creative Direction:**
${userIdeas}`;
            }

            textPrompt += `

TASK: Create an image prompt that places the meme character as the HERO, with the news story providing context/backdrop around them. The character should be REACTING TO or INTERACTING WITH the news elements.`;

            contentParts.push({
                type: 'text',
                text: textPrompt
            });

            userMessageContent = contentParts;
        } else {
            // Text-only message (potentially enhanced with web search results)
            let textPrompt = `Generate an image prompt for this news story:\n\n"${sectionText}"`;

            // Add web search context if found
            if (webSearchContext) {
                textPrompt += `\n\n${webSearchContext}`;
            }

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
            webSearchImages: searchedImages, // Return found images for UI display
        });

    } catch (error) {
        console.error('Image Prompt Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
