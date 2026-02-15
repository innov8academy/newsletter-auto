// API Route: Search for reference images
// POST /api/search-images

import { NextRequest, NextResponse } from 'next/server';
import { searchRelevantImages } from '@/lib/image-search';

export async function POST(request: NextRequest) {
    try {
        const { query, count = 5 } = await request.json();

        if (!query) {
            return NextResponse.json(
                { success: false, error: 'Query is required' },
                { status: 400 }
            );
        }

        console.log(`[SearchImages] Searching for: "${query}"`);
        
        const images = await searchRelevantImages(query, count);
        
        console.log(`[SearchImages] Found ${images.length} images`);

        return NextResponse.json({
            success: true,
            images,
            query,
        });

    } catch (error) {
        console.error('[SearchImages] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
