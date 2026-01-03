import { NextRequest, NextResponse } from 'next/server';
import { loadStyleReferences, buildMultimodalContent, generateCreativePrompt } from '@/lib/image-pipeline';

export async function POST(request: NextRequest) {
    console.log('API: generate-styled-image called');

    try {
        const { storyText, model, apiKey, useStyleRefs = true, useCreativePrompt = true, customPrompt } = await request.json();

        if (!storyText || !apiKey) {
            return NextResponse.json(
                { success: false, error: 'Missing storyText or apiKey' },
                { status: 400 }
            );
        }

        const selectedModel = model || 'google/gemini-3-pro-image-preview';

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

        // Step 3: Build multimodal content
        const multimodalContent = buildMultimodalContent(
            `CRITICAL STYLE INSTRUCTION: Generate an image that EXACTLY matches the visual style of the reference images provided.

The style is "Lo-Fi Digital Grit & Editorial Collage" with these MANDATORY elements:
- Heavy halftone dot patterns and digital noise/grain textures
- Duotone/tritone color treatment (blues, yellows, blacks - NOT realistic colors)
- Photomontage collage aesthetic with cutout elements
- Graphic overlays like data visualizations, geometric shapes
- Raw, urgent, retro-futuristic, slightly dystopian feel
- 16:9 aspect ratio

STUDY THE REFERENCE IMAGES CAREFULLY and replicate their exact aesthetic.

Now create an image in THIS EXACT STYLE that visualizes: ${finalPrompt}`,
            styleImages
        );

        console.log('API: Sending multimodal request to', selectedModel, 'with', styleImages.length, 'style refs');

        // Step 4: Send to Gemini
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

        // Step 5: Extract image URL
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

        return NextResponse.json({
            success: true,
            imageUrl,
            prompt: finalPrompt,
            styleRefsUsed: styleImages.length
        });

    } catch (error) {
        console.error('Styled Image Gen Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
