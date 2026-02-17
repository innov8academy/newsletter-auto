import { NextRequest, NextResponse } from 'next/server';

// KIE API for grok-imagine image-to-image
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { canvasImage, referenceImage, hasReference, width, height } = body;

    const apiKey = process.env.KIE_API_KEY;
    if (!apiKey) {
      // Fallback to OpenRouter if KIE not configured
      return handleOpenRouter(body);
    }

    if (!canvasImage) {
      return NextResponse.json(
        { success: false, error: 'Missing canvas image' },
        { status: 400 }
      );
    }

    // Build prompt for face swap / inpainting
    const aspectInfo = width && height ? `Output exactly ${width}x${height} pixels.` : '';
    
    const prompt = hasReference 
      ? `Replace the red-marked face/head area in this image with the face from the reference image. Match lighting, angle, scale. Keep body, clothing, background exactly the same. Blend naturally. No text or watermarks. ${aspectInfo}`
      : `Remove the red-marked area and fill naturally with appropriate content that matches surroundings. Keep everything else the same. ${aspectInfo}`;

    // Prepare image URLs - KIE needs URLs, not data URLs
    // We'll need to handle this - for now use the data URL directly (some APIs support it)
    const imageUrls = [canvasImage];
    if (referenceImage) {
      imageUrls.push(referenceImage);
    }

    // Create task
    const createResponse = await fetch(`${KIE_API_URL}/createTask`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-imagine/image-to-image',
        input: {
          prompt,
          image_urls: imageUrls,
        }
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[meme-generate] KIE create task error:', createResponse.status, errorText);
      // Fall back to OpenRouter if KIE fails
      console.log('[meme-generate] Falling back to OpenRouter');
      return handleOpenRouter(body);
    }

    const createData = await createResponse.json();
    console.log('[meme-generate] KIE task created:', JSON.stringify(createData, null, 2));

    // Try multiple paths for taskId
    const taskId = createData.data?.taskId || createData.taskId || createData.task_id || createData.id;
    if (!taskId) {
      console.error('[meme-generate] KIE response structure:', Object.keys(createData), createData.data ? Object.keys(createData.data) : 'no data');
      // Fall back to OpenRouter
      console.log('[meme-generate] No taskId, falling back to OpenRouter');
      return handleOpenRouter(body);
    }

    // Poll for result (max 60 seconds)
    const maxAttempts = 30;
    const pollInterval = 2000;
    
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const statusResponse = await fetch(`${KIE_API_URL}/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        }
      });
      
      if (!statusResponse.ok) {
        console.error('[meme-generate] KIE status check failed:', statusResponse.status);
        continue;
      }
      
      const statusData = await statusResponse.json();
      console.log('[meme-generate] KIE status:', statusData.data?.state);
      
      const state = statusData.data?.state;
      
      if (state === 'success') {
        // Get image URL from response
        const imageUrl = statusData.data?.videoInfo?.imageUrl || 
                        statusData.data?.imageUrl ||
                        statusData.data?.output?.image_url;
        
        if (imageUrl) {
          return NextResponse.json({ success: true, imageUrl });
        } else {
          console.error('[meme-generate] No image URL in success response:', statusData);
          return NextResponse.json(
            { success: false, error: 'No image URL in response' },
            { status: 500 }
          );
        }
      } else if (state === 'failed' || state === 'error') {
        return NextResponse.json(
          { success: false, error: statusData.data?.failMsg || 'Generation failed' },
          { status: 500 }
        );
      }
      // Otherwise keep polling (state is likely 'pending' or 'processing')
    }
    
    return NextResponse.json(
      { success: false, error: 'Generation timed out' },
      { status: 504 }
    );

  } catch (error) {
    console.error('[meme-generate] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Fallback to OpenRouter if KIE not configured
async function handleOpenRouter(body: any) {
  const { canvasImage, referenceImage, hasReference, width, height } = body;
  
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'No API key configured (KIE_API_KEY or OPENROUTER_API_KEY)' },
      { status: 500 }
    );
  }

  const aspectInfo = width && height 
    ? `The output image MUST be exactly ${width}x${height} pixels.` 
    : 'Maintain exact same dimensions as input.';
  
  const faceSwapPrompt = `Replace ONLY the red-marked head/face area with the face from the reference image. Match lighting, angle, scale. Blend naturally. Keep everything else EXACTLY the same. No text/watermarks. ${aspectInfo} Output ONLY the final image.`;
  const inpaintPrompt = `Remove the red-marked area and fill naturally. Keep everything else the same. ${aspectInfo} Output ONLY the final image.`;

  const messages: any[] = [{
    role: 'user',
    content: [
      { type: 'text', text: hasReference ? faceSwapPrompt : inpaintPrompt },
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
    },
    body: JSON.stringify({
      model: 'google/gemini-3-pro-image-preview',
      messages,
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[meme-generate] OpenRouter error:', response.status, errorText);
    return NextResponse.json(
      { success: false, error: `API error: ${response.status}` },
      { status: response.status }
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  const urlMatch = content.match(/(https?:\/\/[^\s)"']+|data:image\/[a-zA-Z]+;base64,[^\s)"']+)/);
  if (urlMatch) {
    return NextResponse.json({ success: true, imageUrl: urlMatch[0] });
  }
  
  if (data.choices?.[0]?.message?.images?.[0]?.image_url?.url) {
    return NextResponse.json({ success: true, imageUrl: data.choices[0].message.images[0].image_url.url });
  }

  return NextResponse.json(
    { success: false, error: 'No image in response' },
    { status: 500 }
  );
}
