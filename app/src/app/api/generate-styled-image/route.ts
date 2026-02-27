import { NextRequest, NextResponse } from 'next/server';
import { loadStyleReferences, buildContentWithReferences, generateCreativePrompt } from '@/lib/image-pipeline';
import { calculateCost } from '@/lib/cost-tracker';

export async function POST(request: NextRequest) {
    console.log('API: generate-styled-image called');

    try {
        const {
            storyText,
            model,
            apiKey: clientApiKey,
            useStyleRefs = true,
            useCreativePrompt = true,
            customPrompt,
            referenceImages // NEW: Reference images for content incorporation
        } = await request.json();

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';

        if (!storyText || !apiKey) {
            return NextResponse.json(
                { success: false, error: 'Missing storyText or apiKey' },
                { status: 400 }
            );
        }

        const selectedModel = model || 'google/gemini-3.1-flash-image-preview';
        const hasReferenceImages = referenceImages && referenceImages.length > 0;

        console.log('API: Starting styled image generation', {
            model: selectedModel,
            useStyleRefs,
            hasCustomPrompt: !!customPrompt,
            referenceImageCount: referenceImages?.length || 0
        });

        // Step 1: Use custom prompt if provided, otherwise generate one
        let finalPrompt = storyText;
        if (customPrompt && customPrompt.trim().length > 0) {
            console.log('API: Using provided custom prompt');
            finalPrompt = customPrompt;
        } else if (useCreativePrompt) {
            console.log('API: Generating creative prompt...');
            finalPrompt = await generateCreativePrompt(storyText, apiKey);
            console.log('API: Creative prompt:', finalPrompt.substring(0, 100) + '...');
        }

        // Step 2: Load style references (optional)
        let styleImages: { base64: string; mimeType: string }[] = [];
        if (useStyleRefs) {
            console.log('API: Loading style references...');
            styleImages = loadStyleReferences();
        }

        // Step 3: Build the prompt with reference image instructions
        let imagePrompt = `CRITICAL STYLE INSTRUCTION: Generate an image that EXACTLY matches the visual style of the style reference images provided.

The style is "Lo-Fi Digital Grit & Editorial Collage" with these MANDATORY elements:
- Heavy halftone dot patterns and digital noise/grain textures
- Duotone/tritone color treatment (blues, yellows, blacks - NOT realistic colors)
- Photomontage collage aesthetic with cutout elements
- Graphic overlays like data visualizations, geometric shapes
- Raw, urgent, retro-futuristic, slightly dystopian feel
- 16:9 aspect ratio

STUDY THE STYLE REFERENCE IMAGES CAREFULLY and replicate their exact aesthetic.`;

        // Add reference image instructions if present
        if (hasReferenceImages) {
            imagePrompt += `

CONTENT INCORPORATION INSTRUCTION: You have also been provided with REFERENCE IMAGES containing specific characters, people, or elements. 
You MUST incorporate the visual appearance, pose, expression, or key elements from these reference images into the final generated image.
Merge these reference elements naturally with the scene described below, maintaining the Lo-Fi editorial style.`;
        }

        imagePrompt += `

Now create an image in THIS EXACT STYLE that visualizes: ${finalPrompt}`;

        // Step 4: Build multimodal content with both style refs and reference images
        const multimodalContent = buildContentWithReferences(
            imagePrompt,
            styleImages,
            hasReferenceImages ? referenceImages : undefined
        );

        console.log('API: Sending multimodal request to', selectedModel, 'with', styleImages.length, 'style refs and', referenceImages?.length || 0, 'content refs');

        // Step 5: Send to Gemini
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8-newsletter.local',
                'X-Title': 'Innov8 Styled Image Generator',
            },
            body: JSON.stringify({
                model: selectedModel,
                modalities: ['image', 'text'],
                messages: [
                    {
                        role: 'user',
                        content: multimodalContent
                    }
                ]
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('API: Received response from model');

        // Step 6: Extract image URL
        let imageUrl = '';

        // Check for direct image array (OpenRouter format)
        if (data.choices?.[0]?.message?.images?.[0]?.image_url?.url) {
            imageUrl = data.choices[0].message.images[0].image_url.url;
        } else {
            // Fallback: check content for URL or base64
            const content = data.choices?.[0]?.message?.content || '';
            const urlMatch = content.match(/(https?:\/\/[^\s)]+|data:image\/[a-zA-Z]+;base64,[^\s)]+)/);

            if (urlMatch) {
                imageUrl = urlMatch[0];
            } else {
                console.error('API: No image found in response:', JSON.stringify(data).substring(0, 500));
                throw new Error('No image generated. Model response did not contain an image.');
            }
        }

        // Calculate cost for image generation (per-image pricing)
        const cost = calculateCost(selectedModel, 0, 0, 1);

        return NextResponse.json({
            success: true,
            imageUrl,
            prompt: finalPrompt,
            styleRefsUsed: styleImages.length,
            contentRefsUsed: referenceImages?.length || 0,
            cost,
            costSource: 'image-gen',
            model: selectedModel,
        });

    } catch (error) {
        console.error('Styled Image Gen Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
