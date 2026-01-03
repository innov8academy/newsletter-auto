import { NewsItem, ExtractedStory } from './types';
import { NEWS_EXTRACTION_PROMPT } from './config';

interface ExtractedStoryRaw {
    headline: string;
    summary: string;
    category: string;
    importance: number;
    originalUrl: string | null;
}

// Generate unique ID for stories
function generateStoryId(headline: string, source: string): string {
    const str = `${headline}-${source}-${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Scrape content from a URL using a simple fetch
async function scrapeUrl(url: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

        if (!response.ok) {
            console.error(`Failed to scrape ${url}: ${response.status}`);
            return null;
        }

        const html = await response.text();

        // Simple HTML to text conversion - remove tags and decode entities
        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();

        // Return first 15000 chars to stay within token limits
        return text.substring(0, 15000);
    } catch (error) {
        console.error(`Error scraping ${url}:`, error);
        return null;
    }
}

// Extract individual stories from newsletter content using AI
export async function extractStoriesFromNewsletter(
    newsletter: NewsItem,
    apiKey: string
): Promise<ExtractedStory[]> {
    // Try to scrape the full content if we only have a summary
    let content = newsletter.content || newsletter.summary || '';

    if (content.length < 500 && newsletter.url) {
        const scraped = await scrapeUrl(newsletter.url);
        if (scraped) {
            content = scraped;
        }
    }

    if (!content || content.length < 100) {
        // If no content, return as a single story
        return [{
            id: generateStoryId(newsletter.title, newsletter.sourceName),
            headline: newsletter.title,
            summary: newsletter.summary || newsletter.title,
            category: 'other',
            importance: 5,
            originalUrl: newsletter.url,
            sourceNewsletter: newsletter.sourceName,
            sourceNewsletterUrl: newsletter.url,
            publishedAt: newsletter.publishedAt,
        }];
    }

    const prompt = `${NEWS_EXTRACTION_PROMPT}

NEWSLETTER SOURCE: ${newsletter.sourceName}
NEWSLETTER TITLE: ${newsletter.title}
PUBLISHED: ${newsletter.publishedAt}

CONTENT:
${content.substring(0, 12000)}

Extract the individual news stories as a JSON array. Return ONLY valid JSON, no other text.`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Innov8 AI Newsletter',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.3,
                max_tokens: 4000,
            }),
        });

        if (!response.ok) {
            console.error('OpenRouter API error:', response.status);
            // Return newsletter as single story if API fails
            return [{
                id: generateStoryId(newsletter.title, newsletter.sourceName),
                headline: newsletter.title,
                summary: newsletter.summary || '',
                category: 'other',
                importance: 5,
                originalUrl: newsletter.url,
                sourceNewsletter: newsletter.sourceName,
                sourceNewsletterUrl: newsletter.url,
                publishedAt: newsletter.publishedAt,
            }];
        }

        const data = await response.json();
        const responseContent = data.choices?.[0]?.message?.content || '[]';

        // Parse the JSON response
        let stories: ExtractedStoryRaw[];
        try {
            const cleanContent = responseContent
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
            stories = JSON.parse(cleanContent);
        } catch (e) {
            console.error('Failed to parse AI response:', e);
            return [{
                id: generateStoryId(newsletter.title, newsletter.sourceName),
                headline: newsletter.title,
                summary: newsletter.summary || '',
                category: 'other',
                importance: 5,
                originalUrl: newsletter.url,
                sourceNewsletter: newsletter.sourceName,
                sourceNewsletterUrl: newsletter.url,
                publishedAt: newsletter.publishedAt,
            }];
        }

        // Convert to ExtractedStory with IDs
        return stories.map(story => ({
            id: generateStoryId(story.headline, newsletter.sourceName),
            headline: story.headline,
            summary: story.summary,
            category: story.category || 'other',
            importance: story.importance || 5,
            originalUrl: story.originalUrl,
            sourceNewsletter: newsletter.sourceName,
            sourceNewsletterUrl: newsletter.url,
            publishedAt: newsletter.publishedAt,
        }));

    } catch (error) {
        console.error('Story extraction error:', error);
        return [{
            id: generateStoryId(newsletter.title, newsletter.sourceName),
            headline: newsletter.title,
            summary: newsletter.summary || '',
            category: 'other',
            importance: 5,
            originalUrl: newsletter.url,
            sourceNewsletter: newsletter.sourceName,
            sourceNewsletterUrl: newsletter.url,
            publishedAt: newsletter.publishedAt,
        }];
    }
}

// Process multiple newsletters and extract all stories
export async function extractAllStories(
    newsletters: NewsItem[],
    apiKey: string,
    onProgress?: (current: number, total: number) => void
): Promise<ExtractedStory[]> {
    const allStories: ExtractedStory[] = [];
    const total = newsletters.length;

    // Process newsletters sequentially to avoid rate limits
    for (let i = 0; i < newsletters.length; i++) {
        const newsletter = newsletters[i];

        if (onProgress) {
            onProgress(i + 1, total);
        }

        const stories = await extractStoriesFromNewsletter(newsletter, apiKey);
        allStories.push(...stories);

        // Small delay between requests
        if (i < newsletters.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Sort by importance descending
    allStories.sort((a, b) => b.importance - a.importance);

    // Deduplicate by similar headlines
    const seen = new Set<string>();
    const deduplicated = allStories.filter(story => {
        const normalized = story.headline.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
        if (seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });

    return deduplicated;
}
