import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { canvasImage, referenceImage, hasReference } = body;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'OPENROUTER_API_KEY not configured on server' },
        { status: 500 }
      );
    }

    if (!canvasImage) {
      return NextResponse.json(
        { success: false, error: 'Missing canvas image' },
        { status: 400 }
      );
    }

    // Improved prompts for face/head replacement
    const faceSwapPrompt = `You are an expert image editor. The first image shows a person with their HEAD/FACE area marked in RED. 
The second image is a REFERENCE FACE to use.

Your task:
1. REPLACE ONLY the red-marked head/face area with the face from the reference image
2. Match the lighting, angle, and scale of the original image
3. Blend naturally - the face should look like it belongs on that body
4. Keep the body, clothing, background, and everything else EXACTLY the same
5. Do NOT add any text or watermarks

Output ONLY the final edited image.`;

    const inpaintPrompt = `You are an expert image editor. This image has an area marked in RED that needs to be removed/replaced.

Your task:
1. Remove the red-marked area
2. Fill it naturally with appropriate content that matches the surrounding area
3. Make it look seamless and realistic
4. Keep everything else EXACTLY the same

Output ONLY the final edited image.`;

    const messages: any[] = [{
      role: 'user',
      content: [
        { 
          type: 'text', 
          text: hasReference ? faceSwapPrompt : inpaintPrompt
        },
        { type: 'image_url', image_url: { url: canvasImage } },
      ]
    }];

    if (referenceImage) {
      messages[0].content.push({ type: 'image_url', image_url: { url: referenceImage } });
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.get('origin') || 'https://newsletter-auto.vercel.app',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp-image-generation',
        messages,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[meme-generate] API error:', errorText);
      return NextResponse.json(
        { success: false, error: `API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[meme-generate] AI response received');

    // Extract image URL from response
    const content = data.choices?.[0]?.message?.content || '';
    let imageUrl = null;

    // Try different response formats
    const urlMatch = content.match(/(https?:\/\/[^\s)"']+|data:image\/[a-zA-Z]+;base64,[^\s)"']+)/);
    if (urlMatch) {
      imageUrl = urlMatch[0];
    } else if (data.choices?.[0]?.message?.images?.[0]?.image_url?.url) {
      imageUrl = data.choices[0].message.images[0].image_url.url;
    } else if (Array.isArray(data.choices?.[0]?.message?.content)) {
      // Handle multimodal response format
      const imgPart = data.choices[0].message.content.find((p: any) => p.type === 'image_url' || p.image_url);
      if (imgPart?.image_url?.url) {
        imageUrl = imgPart.image_url.url;
      }
    }

    if (imageUrl) {
      return NextResponse.json({ success: true, imageUrl });
    } else {
      console.error('[meme-generate] No image in response:', data);
      return NextResponse.json(
        { success: false, error: 'No image in AI response' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('[meme-generate] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
