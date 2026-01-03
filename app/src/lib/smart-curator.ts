import { NewsItem, CuratedStory, CurationProgress } from './types';
import { defaultConfig, SCORING_CONFIG, SMART_CURATION_PROMPT } from './config';
import { fetchAllNews, filterByDate } from './news-fetcher';

interface RawExtractedStory {
    headline: string;
    summary: string;
    category: string;
    baseScore: number;
    entities: string[];
    originalUrl: string | null;
}

// Generate unique ID
function generateId(text: string): string {
    let hash = 0;
    const str = `${text}-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Normalize text for comparison
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Calculate similarity between two strings (Jaccard similarity)
function calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(normalizeText(text1).split(' ').filter(w => w.length > 3));
    const words2 = new Set(normalizeText(text2).split(' ').filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

// Scrape content from URL
async function scrapeContent(url: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        if (!response.ok) return null;

        const html = await response.text();
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 12000);
    } catch {
        return null;
    }
}

// Extract stories from a single news item using AI
async function extractStories(
    item: NewsItem,
    apiKey: string
): Promise<RawExtractedStory[]> {
    let content = item.content || item.summary || '';

    // Scrape if content is too short
    if (content.length < 500 && item.url) {
        const scraped = await scrapeContent(item.url);
        if (scraped) content = scraped;
    }

    // If still no content, return as single story
    if (!content || content.length < 100) {
        return [{
            headline: item.title,
            summary: item.summary || item.title,
            category: 'other',
            baseScore: 5,
            entities: [],
            originalUrl: item.url,
        }];
    }

    const prompt = `${SMART_CURATION_PROMPT}

SOURCE: ${item.sourceName}
TITLE: ${item.title}
DATE: ${item.publishedAt}

CONTENT:
${content.substring(0, 10000)}

Return JSON array only.`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Innov8 AI',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 3000,
            }),
        });

        if (!response.ok) {
            return [{
                headline: item.title,
                summary: item.summary || '',
                category: 'other',
                baseScore: 5,
                entities: [],
                originalUrl: item.url,
            }];
        }

        const data = await response.json();
        const content_response = data.choices?.[0]?.message?.content || '[]';

        const cleanContent = content_response
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        return JSON.parse(cleanContent);
    } catch {
        return [{
            headline: item.title,
            summary: item.summary || '',
            category: 'other',
            baseScore: 5,
            entities: [],
            originalUrl: item.url,
        }];
    }
}

// Main curation function
export async function curateNews(
    apiKey: string,
    onProgress?: (progress: CurationProgress) => void,
    customFeeds: any[] = []
): Promise<{ stories: CuratedStory[], stats: any }> { // Temporarily using any for stats to avoid import cycle issues if types verify slowly
    const stories: Map<string, CuratedStory> = new Map();
    const statsBreakdown: Record<string, { found: number, kept: number }> = {};

    // Stage 1: Fetch all RSS feeds
    // Merge default feeds with custom feeds
    const allFeeds = [...defaultConfig.rssFeeds, ...customFeeds];
    allFeeds.forEach(f => statsBreakdown[f.name] = { found: 0, kept: 0 });

    onProgress?.({ stage: 'fetching', current: 0, total: 1, message: `Fetching news from ${allFeeds.length} sources...` });

    const allNews = await fetchAllNews(allFeeds);

    // Track found counts
    allNews.forEach(item => {
        if (statsBreakdown[item.sourceName]) {
            statsBreakdown[item.sourceName].found++;
        }
    });

    // INTELLIGENT BALANCING: Ensure representation from all tiers
    // Instead of just taking the newest 20, we take:
    // - Up to 2 newest items from EACH source (to ensure breadth)
    // - Then fill the rest with the absolute newest remaining
    const candidateItems: NewsItem[] = [];
    const seenUrls = new Set<string>();

    // 1. Quota Round: Take up to 2 items per source
    const itemsBySource = new Map<string, NewsItem[]>();
    allNews.forEach(item => {
        if (!itemsBySource.has(item.sourceName)) itemsBySource.set(item.sourceName, []);
        itemsBySource.get(item.sourceName)?.push(item);
    });

    const QUOTA_PER_SOURCE = 2;
    // Iterate through all sources to fill quota
    for (const [source, items] of itemsBySource) {
        // Sort items by date (newest first) just in case
        items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

        const quotaItems = items.slice(0, QUOTA_PER_SOURCE);
        quotaItems.forEach(item => {
            if (!seenUrls.has(item.url)) {
                candidateItems.push(item);
                seenUrls.add(item.url);
            }
        });
    }

    // 2. Fill Round: If we have space left for the hard limit (e.g. 20), fill with newest ignoring source
    const TOTAL_LIMIT = 20;
    if (candidateItems.length < TOTAL_LIMIT) {
        const remainingNeeded = TOTAL_LIMIT - candidateItems.length;
        const remainingItems = allNews
            .filter(item => !seenUrls.has(item.url))
            .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
            .slice(0, remainingNeeded);

        candidateItems.push(...remainingItems);
    }

    // Sort candidates by date again so we process in order
    candidateItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    // Stage 2: Extract stories from each item
    const totalToProcess = Math.min(candidateItems.length, TOTAL_LIMIT);

    for (let i = 0; i < totalToProcess; i++) {
        const item = candidateItems[i];

        // Track stats
        if (statsBreakdown[item.sourceName]) {
            statsBreakdown[item.sourceName].kept++;
        }

        onProgress?.({
            stage: 'extracting',
            current: i + 1,
            total: totalToProcess,
            message: `Analyzing [${item.sourceName}] ${item.title.substring(0, 30)}...`
        });

        const extracted = await extractStories(item, apiKey);

        // Process each extracted story
        for (const raw of extracted) {
            // Find if similar story exists (deduplication)
            let matchedKey: string | null = null;
            let maxSimilarity = 0;

            for (const [key, existing] of stories) {
                const similarity = calculateSimilarity(raw.headline, existing.headline);
                if (similarity > 0.5 && similarity > maxSimilarity) {
                    matchedKey = key;
                    maxSimilarity = similarity;
                }
            }

            if (matchedKey) {
                // Merge with existing story (cross-source boost)
                const existing = stories.get(matchedKey)!;
                if (!existing.sources.includes(item.sourceName)) {
                    existing.sources.push(item.sourceName);
                    existing.crossSourceCount++;
                }

                // Take higher base score
                if (raw.baseScore > existing.baseScore) {
                    existing.baseScore = raw.baseScore;
                    existing.headline = raw.headline;
                    existing.summary = raw.summary;
                }
            } else {
                // New story
                const id = generateId(raw.headline);
                stories.set(id, {
                    id,
                    headline: raw.headline,
                    summary: raw.summary,
                    category: raw.category || 'other',
                    baseScore: raw.baseScore || 5,
                    finalScore: 0, // Calculate later
                    entities: raw.entities || [],
                    originalUrl: raw.originalUrl,
                    sources: [item.sourceName],
                    publishedAt: item.publishedAt,
                    crossSourceCount: 1,
                    boosts: [],
                });
            }
        }

        // Small delay to avoid rate limits
        if (i < totalToProcess - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // Stage 3: Calculate final scores
    onProgress?.({ stage: 'scoring', current: 0, total: 1, message: 'Calculating final scores...' });

    const now = new Date();

    for (const story of stories.values()) {
        let finalScore = story.baseScore;
        const boosts: string[] = [];

        // Cross-source boost
        if (story.crossSourceCount >= 3) {
            finalScore += SCORING_CONFIG.crossSourceBoost.threePlusSources;
            boosts.push(`+${SCORING_CONFIG.crossSourceBoost.threePlusSources} (3+ sources)`);
        } else if (story.crossSourceCount >= 2) {
            finalScore += SCORING_CONFIG.crossSourceBoost.twoSources;
            boosts.push(`+${SCORING_CONFIG.crossSourceBoost.twoSources} (2 sources)`);
        }

        // Category boost
        const categoryBoost = SCORING_CONFIG.categoryBoost[story.category as keyof typeof SCORING_CONFIG.categoryBoost];
        if (categoryBoost) {
            finalScore += categoryBoost;
            boosts.push(`+${categoryBoost} (${story.category})`);
        }

        // Recency boost (reduced for balancing, but still active)
        const publishedAt = new Date(story.publishedAt);
        const hoursAgo = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
        if (hoursAgo < SCORING_CONFIG.recencyBoostHours) {
            finalScore += 1;
            boosts.push('+1 (recent)');
        }

        story.finalScore = Math.min(finalScore, 10); // Cap at 10
        story.boosts = boosts;
    }

    // Filter and sort
    const result = Array.from(stories.values())
        .filter(s => s.finalScore >= SCORING_CONFIG.minScoreToShow)
        .sort((a, b) => b.finalScore - a.finalScore);

    onProgress?.({ stage: 'done', current: 1, total: 1, message: `Found ${result.length} curated stories` });

    const stats = {
        sourcesAnalyzed: allFeeds.length,
        totalArticlesFound: allNews.length,
        articlesProcessed: totalToProcess,
        breakdown: Object.entries(statsBreakdown).map(([name, counts]) => ({
            sourceName: name,
            found: counts.found,
            kept: counts.kept
        })).sort((a, b) => b.kept - a.kept)
    };

    return { stories: result, stats };
}
