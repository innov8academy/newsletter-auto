import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// KIE API for grok-imagine image-to-image
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';

// Initialize Supabase client for image uploads
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Upload base64 image to Supabase and return public URL
async function uploadImageToSupabase(base64Data: string, filename: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) {
    console.log('[meme-generate] Supabase not configured');
    return null;
  }

  try {
    // Extract base64 content and mime type
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      console.error('[meme-generate] Invalid base64 format');
      return null;
    }
    
    const mimeType = matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');
    
    // Generate unique filename
    const ext = mimeType.split('/')[1] || 'png';
    const uniqueName = `meme-editor/${Date.now()}-${filename}.${ext}`;
    
    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from('temp-images')
      .upload(uniqueName, buffer, {
        contentType: mimeType,
        upsert: true,
      });
    
    if (error) {
      console.error('[meme-generate] Supabase upload error:', error);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('temp-images')
      .getPublicUrl(uniqueName);
    
    console.log('[meme-generate] Uploaded to Supabase:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    console.error('[meme-generate] Upload error:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { canvasImage, referenceImage, hasReference, width, height } = body;

    const kieApiKey = process.env.KIE_API_KEY;
    
    if (!kieApiKey) {
      console.log('[meme-generate] KIE_API_KEY not set, using OpenRouter');
      return handleOpenRouter(body);
    }

    if (!canvasImage) {
      return NextResponse.json(
        { success: false, error: 'Missing canvas image' },
        { status: 400 }
      );
    }

    // Upload images to Supabase to get hosted URLs
    console.log('[meme-generate] Uploading images to Supabase...');
    const canvasUrl = await uploadImageToSupabase(canvasImage, 'canvas');
    
    if (!canvasUrl) {
      console.log('[meme-generate] Failed to upload canvas, falling back to OpenRouter');
      return handleOpenRouter(body);
    }
    
    const imageUrls = [canvasUrl];
    
    if (referenceImage) {
      const refUrl = await uploadImageToSupabase(referenceImage, 'reference');
      if (refUrl) {
        imageUrls.push(refUrl);
      }
    }

    // Build prompt for face swap / inpainting
    const aspectInfo = width && height ? `Output image should be ${width}x${height} pixels.` : '';
    
    const prompt = hasReference 
      ? `Replace the red-marked face/head area in the first image with the face from the second reference image. Match lighting, angle, and scale perfectly. Keep the body, clothing, and background exactly the same. Blend naturally with no visible seams. ${aspectInfo}`
      : `Remove the red-marked area and fill it naturally with appropriate content that matches the surroundings. Keep everything else exactly the same. ${aspectInfo}`;

    console.log('[meme-generate] Creating KIE task with URLs:', imageUrls);

    // Create task with KIE
    const createResponse = await fetch(`${KIE_API_URL}/createTask`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kieApiKey}`,
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
      return handleOpenRouter(body);
    }

    const createData = await createResponse.json();
    console.log('[meme-generate] KIE response:', JSON.stringify(createData, null, 2));

    // Extract taskId from response
    const taskId = createData.data?.taskId || createData.taskId || createData.task_id || createData.id;
    
    if (!taskId) {
      console.error('[meme-generate] No taskId in response:', createData);
      return handleOpenRouter(body);
    }

    console.log('[meme-generate] Task created:', taskId);

    // Poll for result (max 90 seconds for image generation)
    const maxAttempts = 45;
    const pollInterval = 2000;
    
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const statusResponse = await fetch(`${KIE_API_URL}/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${kieApiKey}`,
        }
      });
      
      if (!statusResponse.ok) {
        console.error('[meme-generate] KIE status check failed:', statusResponse.status);
        continue;
      }
      
      const statusData = await statusResponse.json();
      const state = statusData.data?.state || statusData.state;
      console.log(`[meme-generate] Poll ${i + 1}/${maxAttempts}: state=${state}`);
      
      if (state === 'success' || state === 'completed') {
        // Try multiple paths for image URL
        const imageUrl = statusData.data?.output?.image_url ||
                        statusData.data?.output?.images?.[0] ||
                        statusData.data?.videoInfo?.imageUrl ||
                        statusData.data?.imageUrl ||
                        statusData.data?.result?.image_url ||
                        statusData.output?.image_url ||
                        statusData.imageUrl;
        
        if (imageUrl) {
          console.log('[meme-generate] Success! Image URL:', imageUrl);
          return NextResponse.json({ success: true, imageUrl });
        } else {
          console.error('[meme-generate] Success but no image URL:', statusData);
          return NextResponse.json(
            { success: false, error: 'No image URL in success response' },
            { status: 500 }
          );
        }
      } else if (state === 'failed' || state === 'error') {
        const errorMsg = statusData.data?.failMsg || statusData.failMsg || 'Generation failed';
        console.error('[meme-generate] Generation failed:', errorMsg);
        return NextResponse.json(
          { success: false, error: errorMsg },
          { status: 500 }
        );
      }
      // Continue polling for 'pending', 'processing', 'running', etc.
    }
    
    return NextResponse.json(
      { success: false, error: 'Generation timed out after 90 seconds' },
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

// Fallback to OpenRouter/Gemini if KIE not available
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
  console.log('[meme-generate] OpenRouter response structure:', JSON.stringify({
    hasChoices: !!data.choices,
    choiceCount: data.choices?.length,
    messageKeys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [],
    contentType: typeof data.choices?.[0]?.message?.content,
    contentIsArray: Array.isArray(data.choices?.[0]?.message?.content),
  }));
  
  const message = data.choices?.[0]?.message;
  let imageUrl: string | null = null;
  
  // Method 1: Content is array with image parts (Gemini multimodal format)
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        imageUrl = part.image_url.url;
        console.log('[meme-generate] Found image in content array (image_url)');
        break;
      }
      if (part.type === 'image' && part.url) {
        imageUrl = part.url;
        console.log('[meme-generate] Found image in content array (image)');
        break;
      }
      // Gemini sometimes returns inline_data
      if (part.inline_data?.data && part.inline_data?.mime_type) {
        imageUrl = `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
        console.log('[meme-generate] Found inline_data in content array');
        break;
      }
    }
  }
  
  // Method 2: Content is string with URL
  if (!imageUrl && typeof message?.content === 'string') {
    const content = message.content;
    
    // Try HTTP URL
    const urlMatch = content.match(/(https?:\/\/[^\s)"'\]]+)/i);
    if (urlMatch) {
      imageUrl = urlMatch[0];
      console.log('[meme-generate] Found URL in string content');
    }
    
    // Try base64 data URL
    if (!imageUrl) {
      const dataUrlMatch = content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
      if (dataUrlMatch) {
        imageUrl = dataUrlMatch[0];
        console.log('[meme-generate] Found data URL in string content');
      }
    }
  }
  
  // Method 3: Images array in message
  if (!imageUrl && message?.images?.[0]?.image_url?.url) {
    imageUrl = message.images[0].image_url.url;
    console.log('[meme-generate] Found image in message.images array');
  }
  
  // Method 4: Direct image_url on message
  if (!imageUrl && message?.image_url?.url) {
    imageUrl = message.image_url.url;
    console.log('[meme-generate] Found image in message.image_url');
  }
  
  if (imageUrl) {
    return NextResponse.json({ success: true, imageUrl });
  }

  console.error('[meme-generate] No image found. Full response:', JSON.stringify(data).slice(0, 1000));
  return NextResponse.json(
    { success: false, error: 'No image in response' },
    { status: 500 }
  );
}
