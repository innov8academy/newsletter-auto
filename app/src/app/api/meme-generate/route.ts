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
    console.error('[meme-generate] Supabase not configured - need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
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
      console.error('[meme-generate] Supabase upload error:', error.message);
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

    // Check KIE API key
    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return NextResponse.json(
        { success: false, error: 'KIE_API_KEY not configured in environment variables' },
        { status: 500 }
      );
    }

    if (!canvasImage) {
      return NextResponse.json(
        { success: false, error: 'Missing canvas image' },
        { status: 400 }
      );
    }

    // Step 1: Upload images to Supabase to get hosted URLs (KIE requires URLs, not base64)
    console.log('[meme-generate] Uploading canvas image to Supabase...');
    const canvasUrl = await uploadImageToSupabase(canvasImage, 'canvas');
    
    if (!canvasUrl) {
      return NextResponse.json(
        { success: false, error: 'Failed to upload image. Make sure Supabase is configured and "temp-images" bucket exists.' },
        { status: 500 }
      );
    }
    
    const imageUrls = [canvasUrl];
    
    // Upload reference image if provided
    if (referenceImage) {
      console.log('[meme-generate] Uploading reference image to Supabase...');
      const refUrl = await uploadImageToSupabase(referenceImage, 'reference');
      if (refUrl) {
        imageUrls.push(refUrl);
      } else {
        console.warn('[meme-generate] Failed to upload reference image, continuing without it');
      }
    }

    // Step 2: Build prompt for face swap / inpainting
    const aspectInfo = width && height ? `Output image should be ${width}x${height} pixels.` : '';
    
    const prompt = hasReference 
      ? `Replace the red-marked face/head area in the first image with the face from the second reference image. Match lighting, angle, and scale perfectly. Keep the body, clothing, and background exactly the same. Blend naturally with no visible seams. ${aspectInfo}`
      : `Remove the red-marked area and fill it naturally with appropriate content that matches the surroundings. Keep everything else exactly the same. ${aspectInfo}`;

    console.log('[meme-generate] Creating KIE task...');
    console.log('[meme-generate] Image URLs:', imageUrls);
    console.log('[meme-generate] Prompt:', prompt);

    // Step 3: Create task with KIE API
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
      return NextResponse.json(
        { success: false, error: `KIE API error: ${createResponse.status} - ${errorText}` },
        { status: createResponse.status }
      );
    }

    const createData = await createResponse.json();
    console.log('[meme-generate] KIE create response:', JSON.stringify(createData, null, 2));

    // Extract taskId from response
    const taskId = createData.data?.taskId || createData.taskId || createData.task_id || createData.id;
    
    if (!taskId) {
      console.error('[meme-generate] No taskId in KIE response');
      return NextResponse.json(
        { success: false, error: `KIE did not return a task ID. Response: ${JSON.stringify(createData)}` },
        { status: 500 }
      );
    }

    console.log('[meme-generate] Task created with ID:', taskId);

    // Step 4: Poll for result (max 90 seconds for image generation)
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
        // Try multiple paths for image URL in the response
        const imageUrl = statusData.data?.output?.image_url ||
                        statusData.data?.output?.images?.[0] ||
                        statusData.data?.videoInfo?.imageUrl ||
                        statusData.data?.imageUrl ||
                        statusData.data?.result?.image_url ||
                        statusData.data?.result?.images?.[0] ||
                        statusData.output?.image_url ||
                        statusData.imageUrl;
        
        if (imageUrl) {
          console.log('[meme-generate] Success! Image URL:', imageUrl);
          return NextResponse.json({ success: true, imageUrl });
        } else {
          console.error('[meme-generate] Success state but no image URL found:', JSON.stringify(statusData));
          return NextResponse.json(
            { success: false, error: 'Generation succeeded but no image URL in response' },
            { status: 500 }
          );
        }
      } else if (state === 'failed' || state === 'error') {
        const errorMsg = statusData.data?.failMsg || statusData.data?.error || statusData.failMsg || 'Generation failed';
        console.error('[meme-generate] KIE generation failed:', errorMsg);
        return NextResponse.json(
          { success: false, error: `KIE generation failed: ${errorMsg}` },
          { status: 500 }
        );
      }
      // Continue polling for 'pending', 'processing', 'running', 'queued', etc.
    }
    
    return NextResponse.json(
      { success: false, error: 'Generation timed out after 90 seconds' },
      { status: 504 }
    );

  } catch (error) {
    console.error('[meme-generate] Error:', error);
    return NextResponse.json(
      { success: false, error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
