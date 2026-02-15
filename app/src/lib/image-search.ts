// Image Search Helper
// Searches for relevant images based on a news headline
// Uses Brave Search API (if key available) or falls back to scraping

interface ImageSearchResult {
    url: string;
    title: string;
    source: string;
    thumbnail?: string;
}

// Search for images using Brave Search API
async function searchBraveImages(query: string, count: number = 5): Promise<ImageSearchResult[]> {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
        console.log('[ImageSearch] No BRAVE_API_KEY, skipping Brave search');
        return [];
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const response = await fetch(
            `https://api.search.brave.com/res/v1/images/search?q=${encodedQuery}&count=${count}&safesearch=moderate`,
            {
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': apiKey,
                },
            }
        );

        if (!response.ok) {
            console.error('[ImageSearch] Brave API error:', response.status);
            return [];
        }

        const data = await response.json();
        const results = (data.results || []).slice(0, count).map((img: any) => ({
            url: img.properties?.url || img.url,
            title: img.title || '',
            source: img.source || '',
            thumbnail: img.thumbnail?.src,
        }));

        console.log(`[ImageSearch] Brave found ${results.length} images for "${query.substring(0, 40)}..."`);
        return results;
    } catch (error) {
        console.error('[ImageSearch] Brave search failed:', error);
        return [];
    }
}

// Fallback: Search using Serper API (Google Images)
async function searchSerperImages(query: string, count: number = 5): Promise<ImageSearchResult[]> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
        console.log('[ImageSearch] No SERPER_API_KEY, skipping Serper search');
        return [];
    }

    try {
        const response = await fetch('https://google.serper.dev/images', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                q: query,
                num: count,
            }),
        });

        if (!response.ok) {
            console.error('[ImageSearch] Serper API error:', response.status);
            return [];
        }

        const data = await response.json();
        const results = (data.images || []).slice(0, count).map((img: any) => ({
            url: img.imageUrl,
            title: img.title || '',
            source: img.source || '',
            thumbnail: img.thumbnailUrl,
        }));

        console.log(`[ImageSearch] Serper found ${results.length} images`);
        return results;
    } catch (error) {
        console.error('[ImageSearch] Serper search failed:', error);
        return [];
    }
}

// Main search function - tries available providers
export async function searchRelevantImages(
    headline: string,
    count: number = 3
): Promise<ImageSearchResult[]> {
    // Clean up the headline for better search results
    const searchQuery = headline
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);

    console.log(`[ImageSearch] Searching for: "${searchQuery}"`);

    // Try Brave first
    let results = await searchBraveImages(searchQuery, count);
    if (results.length > 0) return results;

    // Try Serper as fallback
    results = await searchSerperImages(searchQuery, count);
    if (results.length > 0) return results;

    console.log('[ImageSearch] No API keys available, returning empty');
    return [];
}

// Fetch image and convert to base64 for use as reference
export async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NewsletterBot/1.0)',
            },
        });

        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        return { base64, mimeType: contentType };
    } catch (error) {
        console.error('[ImageSearch] Failed to fetch image:', url, error);
        return null;
    }
}

// Build a description of found images for prompt enhancement
export function buildImageContext(images: ImageSearchResult[]): string {
    if (images.length === 0) return '';

    const descriptions = images
        .map((img, i) => `${i + 1}. "${img.title}" (from ${img.source})`)
        .join('\n');

    return `
**REAL-WORLD VISUAL REFERENCES (from news coverage):**
${descriptions}

Use these as inspiration for visual elements, composition, and style. The image should feel connected to actual news coverage, not generic stock art.`;
}
