import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// KIE API endpoints
const KIE_CREATE_URL = 'https://api.kie.ai/api/v1/jobs/createTask';
const KIE_QUERY_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';

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
    console.error('[meme-generate] Supabase not configured');
    return null;
  }

  try {
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      console.error('[meme-generate] Invalid base64 format');
      return null;
    }
    
    const mimeType = matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');
    
    const ext = mimeType.split('/')[1] || 'png';
    const uniqueName = `meme-editor/${Date.now()}-${filename}.${ext}`;
    
    const { error } = await supabase.storage
      .from('temp-images')
      .upload(uniqueName, buffer, {
        contentType: mimeType,
        upsert: true,
      });
    
    if (error) {
      console.error('[meme-generate] Supabase upload error:', error.message);
      return null;
    }
    
    const { data: urlData } = supabase.storage
      .from('temp-images')
      .getPublicUrl(uniqueName);
    
    console.log('[meme-generate] Uploaded:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    console.error('[meme-generate] Upload error:', err);
    return null;
  }
}

// Calculate aspect ratio string from dimensions
function getAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  
  // Map to supported aspect ratios
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 4/3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3/4) < 0.1) return '3:4';
  if (Math.abs(ratio - 16/9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9/16) < 0.1) return '9:16';
  if (Math.abs(ratio - 2/3) < 0.1) return '2:3';
  if (Math.abs(ratio - 3/2) < 0.1) return '3:2';
  if (Math.abs(ratio - 21/9) < 0.1) return '21:9';
  
  // Default to closest common ratio
  if (ratio > 1.5) return '16:9';
  if (ratio < 0.67) return '9:16';
  if (ratio > 1) return '4:3';
  return '3:4';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { canvasImage, referenceImage, hasReference, width, height } = body;

    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return NextResponse.json(
        { success: false, error: 'KIE_API_KEY not configured' },
        { status: 500 }
      );
    }

    if (!canvasImage) {
      return NextResponse.json(
        { success: false, error: 'Missing canvas image' },
        { status: 400 }
      );
    }

    // Step 1: Upload image to Supabase
    console.log('[meme-generate] Uploading image to Supabase...');
    const canvasUrl = await uploadImageToSupabase(canvasImage, 'canvas');
    
    if (!canvasUrl) {
      return NextResponse.json(
        { success: false, error: 'Failed to upload image. Check Supabase config and temp-images bucket.' },
        { status: 500 }
      );
    }

    // Step 2: Build prompt
    const prompt = hasReference 
      ? `Edit this image: Replace the red/highlighted marked area with a new face that fits naturally. Match the lighting, angle, and scale. Keep the body, clothing, and background exactly the same. Blend seamlessly.`
      : `Edit this image: Remove the red/highlighted marked area and fill it naturally with content that matches the surrounding area. Keep everything else exactly the same.`;

    // Step 3: Determine aspect ratio
    const aspectRatio = width && height ? getAspectRatio(width, height) : '1:1';

    console.log('[meme-generate] Creating KIE task with seedream/4.5-edit...');
    console.log('[meme-generate] Image URL:', canvasUrl);
    console.log('[meme-generate] Aspect ratio:', aspectRatio);

    // Step 4: Create task with KIE seedream/4.5-edit model
    const createResponse = await fetch(KIE_CREATE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kieApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'seedream/4.5-edit',
        input: {
          prompt,
          image_urls: [canvasUrl],
          aspect_ratio: aspectRatio,
          quality: 'basic',  // Use 'high' for 4K output
        }
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[meme-generate] KIE create error:', createResponse.status, errorText);
      return NextResponse.json(
        { success: false, error: `KIE API error: ${createResponse.status} - ${errorText}` },
        { status: createResponse.status }
      );
    }

    const createData = await createResponse.json();
    console.log('[meme-generate] KIE create response:', JSON.stringify(createData));

    if (createData.code !== 200) {
      return NextResponse.json(
        { success: false, error: `KIE error: ${createData.msg}` },
        { status: 500 }
      );
    }

    const taskId = createData.data?.taskId;
    if (!taskId) {
      return NextResponse.json(
        { success: false, error: 'No taskId returned from KIE' },
        { status: 500 }
      );
    }

    console.log('[meme-generate] Task created:', taskId);

    // Step 5: Poll for result using recordInfo endpoint
    const maxAttempts = 60;  // 2 minutes max
    const pollInterval = 2000;
    
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const statusResponse = await fetch(`${KIE_QUERY_URL}?taskId=${taskId}`, {
        headers: {
          'Authorization': `Bearer ${kieApiKey}`,
        }
      });
      
      if (!statusResponse.ok) {
        console.error('[meme-generate] Status check failed:', statusResponse.status);
        continue;
      }
      
      const statusData = await statusResponse.json();
      const state = statusData.data?.state;
      console.log(`[meme-generate] Poll ${i + 1}/${maxAttempts}: state=${state}`);
      
      if (state === 'success') {
        // Parse resultJson to get the image URL
        try {
          const resultJson = JSON.parse(statusData.data.resultJson || '{}');
          const imageUrl = resultJson.resultUrls?.[0];
          
          if (imageUrl) {
            console.log('[meme-generate] Success! Image:', imageUrl);
            return NextResponse.json({ success: true, imageUrl });
          } else {
            console.error('[meme-generate] No resultUrls in response:', resultJson);
            return NextResponse.json(
              { success: false, error: 'No image URL in success response' },
              { status: 500 }
            );
          }
        } catch (parseErr) {
          console.error('[meme-generate] Failed to parse resultJson:', statusData.data.resultJson);
          return NextResponse.json(
            { success: false, error: 'Failed to parse result' },
            { status: 500 }
          );
        }
      } else if (state === 'fail') {
        const errorMsg = statusData.data?.failMsg || 'Generation failed';
        console.error('[meme-generate] Failed:', errorMsg);
        return NextResponse.json(
          { success: false, error: `KIE generation failed: ${errorMsg}` },
          { status: 500 }
        );
      }
      // Continue polling for 'waiting' state
    }
    
    return NextResponse.json(
      { success: false, error: 'Generation timed out after 2 minutes' },
      { status: 504 }
    );

  } catch (error) {
    console.error('[meme-generate] Error:', error);
    return NextResponse.json(
      { success: false, error: `Server error: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 500 }
    );
  }
}
