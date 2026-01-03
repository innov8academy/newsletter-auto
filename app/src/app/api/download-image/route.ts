
import { NextRequest, NextResponse } from 'next/server';

// App Router: Config to allow larger bodies for base64 images
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '50mb',
        },
    },
};

export async function POST(request: NextRequest) {
    try {
        const json = await request.json();
        const { imageUrl, filename } = json;

        if (!imageUrl) {
            console.error('Download API: No image URL provided');
            return NextResponse.json({ error: 'No image URL provided' }, { status: 400 });
        }

        console.log(`Download API: Processing download for ${filename || 'image'}`);

        let imageBuffer: Buffer;
        let contentType = 'image/png';
        let finalFilename = filename || 'download.png';

        if (imageUrl.startsWith('data:')) {
            // BASE64 HANDLING
            console.log('Download API: Processing Base64 Data URL');
            const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

            if (!matches || matches.length !== 3) {
                console.error('Download API: Invalid data URL format');
                return NextResponse.json({ error: 'Invalid data URL format' }, { status: 400 });
            }

            contentType = matches[1];
            const base64Data = matches[2];
            imageBuffer = Buffer.from(base64Data, 'base64');
            console.log(`Download API: Decoded Base64, buffer size: ${imageBuffer.length} bytes, type: ${contentType}`);

        } else {
            // EXTERNAL URL HANDLING
            console.log('Download API: Fetching external URL:', imageUrl);

            // Add User-Agent to mimic a browser (avoids 403s from some CDNs)
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });

            if (!response.ok) {
                console.error(`Download API: Failed to fetch external URL: ${response.status}`);
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
            contentType = response.headers.get('content-type') || 'image/png';
            console.log(`Download API: Fetched external image, buffer size: ${imageBuffer.length} bytes, type: ${contentType}`);
        }

        // Ensure correct extension
        const ext = contentType.split('/')[1] || 'png';
        // Clean filename of existing extension if present to avoid double extension
        const baseName = finalFilename.replace(/\.[^/.]+$/, "");
        finalFilename = `${baseName}.${ext}`;

        // Return proper binary response
        return new NextResponse(new Uint8Array(imageBuffer), {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${finalFilename}"`,
                'Content-Length': imageBuffer.length.toString(),
            },
        });

    } catch (error) {
        console.error('Download API Critical Error:', error);
        return NextResponse.json(
            { error: 'Server processing failed' },
            { status: 500 }
        );
    }
}
