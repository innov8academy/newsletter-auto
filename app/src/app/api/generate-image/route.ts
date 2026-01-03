
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    console.log('API: generate-image called');
    try {
        const { prompt, model, apiKey } = await request.json();
        console.log('API: generate-image params:', { model, promptLength: prompt?.length });

        if (!prompt || !model || !apiKey) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Default to FLUX.1.1 Pro if invalid model passed
        const selectedModel = model || 'black-forest-labs/flux-1.1-pro';

        let imageUrl = '';

        // Check if using a model that might be Chat-based (Gemini/Seedream often accessed via Chat on OR)
        const isChatModel = selectedModel.includes('gemini') || selectedModel.includes('seedream') || selectedModel.includes('gpt');

        if (isChatModel) {
            console.log('API: Routing to Chat Completions for model:', selectedModel);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://innov8-newsletter.local',
                    'X-Title': 'Innov8 Image Generator',
                },
                body: JSON.stringify({
                    model: selectedModel,
                    modalities: ['image', 'text'], // Matches user snippet order
                    // image_config: { aspect_ratio: '16:9' }, // Temporarily removed to match snippet exactly if needed, but keeping generally safe. 
                    // Actually, let's keep it minimal as per snippet for 3-Pro if it helps.
                    // User snippet had NO image_config. Let's try sending it to be safe, if it fails we remove.
                    // But for now, I'll align specifically with the modalites.
                    messages: [
                        {
                            role: 'user',
                            content: `Generate a photorealistic 16:9 image of: ${prompt}.`
                        }
                    ],
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                // If 404/405, it might be a true error
                throw new Error(`OpenRouter Chat API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('API: Full OpenRouter Response:', JSON.stringify(data, null, 2));

            // Check for direct image array (OpenRouter specific extension for some models)
            // @ts-ignore
            if (data.choices?.[0]?.message?.images?.[0]?.image_url?.url) {
                // @ts-ignore
                imageUrl = data.choices[0].message.images[0].image_url.url;
            } else {
                const content = data.choices?.[0]?.message?.content || '';
                // Extract URL from markdown (http or data:image)
                const urlMatch = content.match(/(https?:\/\/[^\s)]+|data:image\/[a-zA-Z]+;base64,[^\s)]+)/);

                if (urlMatch) {
                    imageUrl = urlMatch[0];
                } else {
                    // Return the FULL JSON in the error so we can see what happened
                    const debugData = JSON.stringify(data).substring(0, 500); // Limit length
                    throw new Error(`Model returned no URL. Raw Response: ${debugData}`);
                }
            }

        } else {
            // Standard Image API (Flux, DALL-E)
            console.log('API: Routing to Image Generations for model:', selectedModel);
            const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://innov8-newsletter.local',
                    'X-Title': 'Innov8 Image Generator',
                },
                body: JSON.stringify({
                    model: selectedModel,
                    prompt: prompt,
                    ...(selectedModel.includes('dall-e') ? { size: "1024x1024" } : {}),
                    ...(selectedModel.includes('flux') ? { aspect_ratio: "16:9" } : {}),
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter Image API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            imageUrl = data.data?.[0]?.url;
        }

        if (!imageUrl) {
            throw new Error('No image URL received from API');
        }

        return NextResponse.json({ success: true, imageUrl: imageUrl });

    } catch (error) {
        console.error('Image Gen Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
