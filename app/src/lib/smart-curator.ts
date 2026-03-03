import { NewsItem, CuratedStory, CurationProgress, FeedHealth } from './types';
import { defaultConfig, SCORING_CONFIG, SMART_CURATION_PROMPT } from './config';
import { fetchAllNews, filterByDate } from './news-fetcher';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

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

// Fetch previously used story headlines from Supabase (last 30 days)
async function fetchUsedStoryHeadlines(): Promise<string[]> {
    if (!isSupabaseConfigured()) {
        console.log('[Duplicate Check] Supabase not configured, skipping');
        return [];
    }

    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data, error } = await supabaseAdmin
            .from('used_stories')
            .select('headline')
            .gte('used_at', sevenDaysAgo.toISOString())
            .order('used_at', { ascending: false });

        if (error) {
            console.error('[Duplicate Check] Error fetching used stories:', error);
            return [];
        }

        console.log(`[Duplicate Check] Found ${data?.length || 0} previously used stories`);
        return (data || []).map(s => s.headline);
    } catch (e) {
        console.error('[Duplicate Check] Exception:', e);
        return [];
    }
}

// Check if a story headline is too similar to previously used ones
function isStoryUsed(headline: string, usedHeadlines: string[], threshold: number = 0.7): boolean {
    for (const usedHeadline of usedHeadlines) {
        const similarity = calculateSimilarity(headline, usedHeadline);
        if (similarity >= threshold) {
            console.log(`[Duplicate Check] Skipping "${headline.substring(0, 40)}..." (${(similarity * 100).toFixed(0)}% similar to used)`);
            return true;
        }
    }
    return false;
}

import { scrapeUrl } from './firecrawl';

// [Deleted internal scrapeContent function]

// Extract stories from a single news item using AI
async function extractStories(
    item: NewsItem,
    apiKey: string
): Promise<RawExtractedStory[]> {
    let content = item.content || item.summary || '';

    // X/Twitter items — extract with dynamic engagement-based scoring
    if (item.source === 'x_twitter') {
        const tweetText = item.content || item.summary || item.title || '';
        // Clean the @handle prefix from title
        const cleanTitle = (item.title || '').replace(/^@\w+:\s*/, '').substring(0, 120);

        // Parse engagement data from enriched summary (format: "text [123 likes, 45 RTs]")
        let engagement = 0;
        let sourceMethod = 'search';
        const engMatch = (item.summary || '').match(/\[(\d+) likes?, (\d+) RTs?\]/);
        if (engMatch) {
            engagement = parseInt(engMatch[1]) + parseInt(engMatch[2]) * 2;
        }

        // Try parsing JSON engagement from raw data
        try {
            const meta = JSON.parse(item.content || '{}');
            if (meta.engagement_score) engagement = meta.engagement_score;
            if (meta.source_method) sourceMethod = meta.source_method;
        } catch { /* not JSON, that's fine */ }

        // Dynamic scoring based on engagement
        let baseScore: number;
        if (engagement > 10000) baseScore = 9;
        else if (engagement > 5000) baseScore = 8;
        else if (engagement > 1000) baseScore = 7;
        else baseScore = 6;

        // News API stories get +1 boost (already Grok-curated)
        if (sourceMethod === 'news_api') baseScore = Math.min(baseScore + 1, 10);

        return [{
            headline: cleanTitle || tweetText.split('\n')[0].substring(0, 120),
            summary: tweetText.substring(0, 500),
            category: 'news',
            baseScore,
            entities: [],
            originalUrl: item.url,
        }];
    }

    // INTELLIGENT UPGRADE:
    // Always attempt to get more context if the initial feed content is thin.
    // 600 chars is roughly 2 paragraphs. If less, we likely just have a teaser.
    if (!content || content.length < 600 && item.url) {
        const scrapeResult = await scrapeUrl(item.url);
        if (scrapeResult.content && scrapeResult.content.length > 500) {
            content = `[Full Content Retrieved via ${scrapeResult.method}]\n\n${scrapeResult.content}`;
        }
    }

    // If still no content, return as single story (fallback)
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
${content.substring(0, 15000)}

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

        const parsed = JSON.parse(cleanContent);
        return Array.isArray(parsed) ? parsed : [];
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

    const { items: allNews, feedHealth } = await fetchAllNews(allFeeds);

    // Track found counts
    allNews.forEach(item => {
        if (statsBreakdown[item.sourceName]) {
            statsBreakdown[item.sourceName].found++;
        }
    });

    // TIERED BUDGET: Give newsletters more slots (they contain multiple stories)
    // Tier 1 (newsletters): 4 items each — they yield 3-6 stories per item
    // Tier 2-4: 2 items each — single stories
    const TIER_BUDGET: Record<number, number> = { 1: 4, 2: 2, 3: 2, 4: 2 };
    const SOFT_CAP = 40;

    const candidateItems: NewsItem[] = [];
    const seenUrls = new Set<string>();

    // Group items by source
    const itemsBySource = new Map<string, NewsItem[]>();
    allNews.forEach(item => {
        if (!itemsBySource.has(item.sourceName)) itemsBySource.set(item.sourceName, []);
        itemsBySource.get(item.sourceName)?.push(item);
    });

    // Build a tier lookup from feeds config
    const feedTierMap = new Map<string, number>();
    allFeeds.forEach(f => feedTierMap.set(f.name, f.tier ?? 2));

    // Quota round: take tiered budget per source
    for (const [source, items] of itemsBySource) {
        // Skip X items (handled separately in their own panel)
        if (source.startsWith('X: @') || source === 'X/Twitter AI') continue;

        items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        const tier = feedTierMap.get(source) ?? 2;
        const budget = TIER_BUDGET[tier] ?? 2;

        items.slice(0, budget).forEach(item => {
            if (!seenUrls.has(item.url)) {
                candidateItems.push(item);
                seenUrls.add(item.url);
            }
        });
    }

    // Fill round: if under soft cap, add more items by recency
    if (candidateItems.length < SOFT_CAP) {
        const remainingNeeded = SOFT_CAP - candidateItems.length;
        const remainingItems = allNews
            .filter(item => !seenUrls.has(item.url) && !item.sourceName.startsWith('X: @'))
            .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
            .slice(0, remainingNeeded);

        candidateItems.push(...remainingItems);
    }

    // Sort candidates by date so we process newest first
    candidateItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    console.log(`[News] ${allNews.length} fresh items → ${candidateItems.length} candidates for extraction`);

    // Stage 2: Extract stories from each item — process ALL candidates (no hard cap)
    const totalToProcess = candidateItems.length;

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

        // Tier weight — apply multiplier based on the highest-tier source
        const bestTier = Math.min(...story.sources.map(s => feedTierMap.get(s) ?? 2));
        const tierWeight = SCORING_CONFIG.tierWeight[bestTier] ?? 1.0;
        if (tierWeight !== 1.0) {
            finalScore = finalScore * tierWeight;
            boosts.push(`×${tierWeight} (tier ${bestTier})`);
        }

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

    // Filter and sort — primary pass with normal threshold
    const allScored = Array.from(stories.values()).sort((a, b) => b.finalScore - a.finalScore);
    let result = allScored.filter(s => s.finalScore >= SCORING_CONFIG.minScoreToShow);
    let curationMode = 'normal';

    // Adaptive minimum guarantee: if below target, progressively relax threshold
    if (result.length < SCORING_CONFIG.targetMinStories) {
        const relaxed = allScored.filter(s => s.finalScore >= SCORING_CONFIG.hardFloorScore);
        if (relaxed.length > result.length) {
            result = relaxed.slice(0, Math.max(SCORING_CONFIG.targetMinStories, relaxed.length));
            curationMode = 'relaxed';
            console.log(`[Adaptive] Relaxed threshold to ${SCORING_CONFIG.hardFloorScore} — ${result.length} stories (target: ${SCORING_CONFIG.targetMinStories})`);
        }
    }

    // Stage 4: Filter out previously used stories
    onProgress?.({ stage: 'scoring', current: 1, total: 1, message: 'Checking for duplicates...' });

    const usedHeadlines = await fetchUsedStoryHeadlines();
    if (usedHeadlines.length > 0) {
        const beforeCount = result.length;
        result = result.filter(story => !isStoryUsed(story.headline, usedHeadlines));
        const filtered = beforeCount - result.length;
        if (filtered > 0) {
            console.log(`[Duplicate Check] Filtered out ${filtered} previously used stories`);
        }
    }

    console.log(`[News] Final: ${result.length} stories (mode: ${curationMode})`);
    onProgress?.({ stage: 'done', current: 1, total: 1, message: `Found ${result.length} curated stories` });

    const stats = {
        sourcesAnalyzed: allFeeds.length,
        totalArticlesFound: allNews.length,
        articlesProcessed: totalToProcess,
        curationMode,
        feedHealth,
        breakdown: Object.entries(statsBreakdown).map(([name, counts]) => ({
            sourceName: name,
            found: counts.found,
            kept: counts.kept
        })).sort((a, b) => b.kept - a.kept)
    };

    return { stories: result, stats };
}
